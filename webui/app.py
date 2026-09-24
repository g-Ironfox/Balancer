import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal

from bson import ObjectId
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.errors import DuplicateKeyError


BASE_DIR = Path(__file__).resolve().parent
MAKER_DIR = BASE_DIR / "static" / "makerpage"
UPLOAD_DIR = BASE_DIR / "uploads"
ALLOWED_IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024


class ActivityInput(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=20)
    location: str = Field(min_length=1, max_length=100)
    start_time: datetime
    end_time: datetime
    capacity: int = Field(ge=1, le=100000)
    status: Literal["草稿", "报名中", "进行中", "已结束", "已取消"] = "草稿"
    description: str = Field(default="", max_length=1000)
    incentive: str = Field(default="", max_length=1000)
    incentive_details: str = Field(default="", max_length=2000)
    incentive_images: list[str] = Field(default_factory=list)
    images: list[str] = Field(default_factory=list)

    @field_validator("title", "location", "category")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value

    @field_validator("description", "incentive", "incentive_details")
    @classmethod
    def strip_description(cls, value: str) -> str:
        return value.strip()


class RegistrationInput(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    contact: str = Field(min_length=1, max_length=100)

    @field_validator("name", "contact")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value


class CategoryInput(BaseModel):
    name: str = Field(min_length=1, max_length=20)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value


class ActivityPage(BaseModel):
    items: list[dict]
    total: int
    page: int
    page_size: int


def serialize_activity(document: dict, public: bool = False) -> dict:
    result = {
        "id": str(document["_id"]),
        "title": document["title"],
        "category": document["category"],
        "location": document["location"],
        "start_time": document["start_time"].replace(tzinfo=timezone.utc),
        "end_time": document["end_time"].replace(tzinfo=timezone.utc),
        "capacity": document["capacity"],
        "status": document["status"],
        "description": document.get("description", ""),
        "incentive": document.get("incentive", ""),
        "images": document.get("images", []),
        "created_at": document["created_at"],
        "updated_at": document["updated_at"],
    }
    if not public:
        result["incentive_details"] = document.get("incentive_details", "")
        result["incentive_images"] = document.get("incentive_images", [])
    return result


def get_collection(request: Request) -> Collection:
    return request.app.state.database.activities


def get_categories(request: Request) -> Collection:
    return request.app.state.database.categories


Activities = Annotated[Collection, Depends(get_collection)]
Categories = Annotated[Collection, Depends(get_categories)]

DEFAULT_CATEGORIES = ["工作坊", "创客马拉松", "技术分享", "开源项目", "社团会议", "其他"]


def object_id_or_404(raw_id: str, missing_message: str = "活动不存在") -> ObjectId:
    if not ObjectId.is_valid(raw_id):
        raise HTTPException(status_code=404, detail=missing_message)
    return ObjectId(raw_id)


def require_category(categories: Collection, name: str) -> None:
    if categories.count_documents({"name": name}) == 0:
        raise HTTPException(status_code=422, detail="类别不存在，请先在类别面板中添加")


def serialize_category(document: dict, usage: int) -> dict:
    return {"id": str(document["_id"]), "name": document["name"], "usage": usage}


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = MongoClient(
        host=os.getenv("MONGO_HOST") or "mongodb",
        port=int(os.getenv("MONGO_PORT", "27017")),
        username=os.getenv("MONGO_USER") or None,
        password=os.getenv("MONGO_PASS") or None,
        authSource="admin",
    )
    database = client[os.getenv("MONGO_DB", "balancer")]
    database.activities.create_index([("start_time", ASCENDING)])
    database.activities.create_index([("updated_at", DESCENDING)])
    database.registrations.create_index([("activity_id", ASCENDING), ("contact", ASCENDING)], unique=True)
    database.categories.create_index("name", unique=True)
    if database.categories.count_documents({}) == 0:
        seeded_at = datetime.now(timezone.utc)
        database.categories.insert_many(
            [{"name": name, "created_at": seeded_at} for name in DEFAULT_CATEGORIES]
        )
    app.state.database = database
    yield
    client.close()


app = FastAPI(title="Maker 开源硬件社 · 活动管理", lifespan=lifespan)


@app.get("/api/activities", response_model=ActivityPage)
def list_activities(
    activities: Activities,
    keyword: str = Query(default="", max_length=100),
    activity_status: str = Query(default="", alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> ActivityPage:
    filters: dict = {}
    if keyword.strip():
        escaped = re.escape(keyword.strip())
        filters["$or"] = [
            {"title": {"$regex": escaped, "$options": "i"}},
            {"location": {"$regex": escaped, "$options": "i"}},
        ]
    if activity_status:
        filters["status"] = activity_status

    total = activities.count_documents(filters)
    cursor = (
        activities.find(filters)
        .sort("start_time", ASCENDING)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    return ActivityPage(
        items=[serialize_activity(item) for item in cursor],
        total=total,
        page=page,
        page_size=page_size,
    )


@app.get("/api/public/activities", response_model=ActivityPage)
def public_activities(
    activities: Activities,
    view: Literal["upcoming", "past"] = "upcoming",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=6, ge=1, le=30),
) -> ActivityPage:
    now = datetime.now(timezone.utc)
    if view == "upcoming":
        filters = {"status": {"$in": ["报名中", "进行中"]}, "end_time": {"$gte": now}}
        direction = ASCENDING
    else:
        filters = {
            "status": {"$in": ["报名中", "进行中", "已结束"]},
            "$or": [{"status": "已结束"}, {"end_time": {"$lt": now}}],
        }
        direction = DESCENDING
    total = activities.count_documents(filters)
    cursor = (
        activities.find(filters)
        .sort("start_time", direction)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    return ActivityPage(
        items=[serialize_activity(item, public=True) for item in cursor],
        total=total,
        page=page,
        page_size=page_size,
    )


@app.get("/api/activities/summary")
def activity_summary(activities: Activities) -> dict[str, int]:
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if month_start.month == 12:
        next_month = month_start.replace(year=month_start.year + 1, month=1)
    else:
        next_month = month_start.replace(month=month_start.month + 1)
    upcoming_limit = now + timedelta(days=30)
    return {
        "total": activities.count_documents({}),
        "open": activities.count_documents({"status": "报名中"}),
        "upcoming": activities.count_documents(
            {"start_time": {"$gte": now, "$lte": upcoming_limit}, "status": {"$ne": "已取消"}}
        ),
        "month": activities.count_documents(
            {"start_time": {"$gte": month_start, "$lt": next_month}, "status": {"$ne": "已取消"}}
        ),
    }


@app.get("/api/activities/{activity_id}")
def get_activity(activity_id: str, activities: Activities) -> dict:
    document = activities.find_one({"_id": object_id_or_404(activity_id)})
    if document is None:
        raise HTTPException(status_code=404, detail="活动不存在")
    return serialize_activity(document)


@app.post("/api/public/activities/{activity_id}/register", status_code=status.HTTP_201_CREATED)
def register_activity(activity_id: str, payload: RegistrationInput, request: Request) -> dict:
    activity_id_obj = object_id_or_404(activity_id)
    activity = request.app.state.database.activities.find_one({"_id": activity_id_obj})
    if activity is None:
        raise HTTPException(status_code=404, detail="活动不存在")
    if activity["status"] != "报名中" or activity["end_time"] <= datetime.now(timezone.utc):
        raise HTTPException(status_code=409, detail="该活动暂不接受报名")
    registrations = request.app.state.database.registrations
    if registrations.count_documents({"activity_id": activity_id_obj}) >= activity["capacity"]:
        raise HTTPException(status_code=409, detail="活动名额已满")
    try:
        registrations.insert_one({"activity_id": activity_id_obj, **payload.model_dump(), "created_at": datetime.now(timezone.utc)})
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="该联系方式已报名") from None
    return {
        "incentive_details": activity.get("incentive_details", ""),
        "incentive_images": activity.get("incentive_images", []),
    }


@app.post("/api/activities", status_code=status.HTTP_201_CREATED)
def create_activity(payload: ActivityInput, activities: Activities, categories: Categories) -> dict:
    require_category(categories, payload.category)
    if payload.end_time <= payload.start_time:
        raise HTTPException(status_code=422, detail="结束时间必须晚于开始时间")
    now = datetime.now(timezone.utc)
    document = payload.model_dump()
    document.update(created_at=now, updated_at=now)
    result = activities.insert_one(document)
    document["_id"] = result.inserted_id
    return serialize_activity(document)


@app.put("/api/activities/{activity_id}")
def update_activity(activity_id: str, payload: ActivityInput, activities: Activities, categories: Categories) -> dict:
    require_category(categories, payload.category)
    if payload.end_time <= payload.start_time:
        raise HTTPException(status_code=422, detail="结束时间必须晚于开始时间")
    update = payload.model_dump()
    update["updated_at"] = datetime.now(timezone.utc)
    document = activities.find_one_and_update(
        {"_id": object_id_or_404(activity_id)},
        {"$set": update},
        return_document=True,
    )
    if document is None:
        raise HTTPException(status_code=404, detail="活动不存在")
    return serialize_activity(document)


@app.delete("/api/activities/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_activity(activity_id: str, activities: Activities) -> Response:
    result = activities.delete_one({"_id": object_id_or_404(activity_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="活动不存在")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/categories")
def list_categories(activities: Activities, categories: Categories) -> list[dict]:
    return [
        serialize_category(item, activities.count_documents({"category": item["name"]}))
        for item in categories.find().sort("created_at", ASCENDING)
    ]


@app.post("/api/categories", status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryInput, categories: Categories) -> dict:
    if categories.count_documents({"name": payload.name}):
        raise HTTPException(status_code=409, detail="该类别已存在")
    document = {"name": payload.name, "created_at": datetime.now(timezone.utc)}
    document["_id"] = categories.insert_one(document).inserted_id
    return serialize_category(document, 0)


@app.put("/api/categories/{category_id}")
def rename_category(
    category_id: str, payload: CategoryInput, activities: Activities, categories: Categories
) -> dict:
    document = categories.find_one({"_id": object_id_or_404(category_id, "类别不存在")})
    if document is None:
        raise HTTPException(status_code=404, detail="类别不存在")
    old_name = document["name"]
    if payload.name != old_name and categories.count_documents({"name": payload.name}):
        raise HTTPException(status_code=409, detail="该类别已存在")
    categories.update_one({"_id": document["_id"]}, {"$set": {"name": payload.name}})
    if payload.name != old_name:
        activities.update_many({"category": old_name}, {"$set": {"category": payload.name}})
    document["name"] = payload.name
    return serialize_category(document, activities.count_documents({"category": payload.name}))


@app.delete("/api/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: str, activities: Activities, categories: Categories) -> Response:
    document = categories.find_one({"_id": object_id_or_404(category_id, "类别不存在")})
    if document is None:
        raise HTTPException(status_code=404, detail="类别不存在")
    usage = activities.count_documents({"category": document["name"]})
    if usage:
        raise HTTPException(
            status_code=409, detail=f"该类别下还有 {usage} 个活动，请先修改或删除这些活动"
        )
    categories.delete_one({"_id": document["_id"]})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/uploads/image", status_code=status.HTTP_201_CREATED)
async def upload_image(image: Annotated[UploadFile, File()]) -> dict[str, str]:
    suffix = ALLOWED_IMAGE_TYPES.get(image.content_type or "")
    if suffix is None:
        raise HTTPException(status_code=422, detail="仅支持 PNG / JPEG / WebP / GIF 图片")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    target = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    size = 0
    try:
        with target.open("wb") as buffer:
            while chunk := await image.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_IMAGE_BYTES:
                    raise HTTPException(status_code=413, detail="图片不能超过 5 MB")
                buffer.write(chunk)
    except HTTPException:
        target.unlink(missing_ok=True)
        raise
    return {"url": f"/uploads/{target.name}"}


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(MAKER_DIR / "index.html")


@app.get("/admin", include_in_schema=False)
def admin() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")