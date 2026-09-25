import os
import re
import hashlib
import secrets
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
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from redis import Redis


BASE_DIR = Path(__file__).resolve().parent
MAKER_DIR = BASE_DIR / "static" / "makerpage"
LOGIN_FILE = BASE_DIR / "static" / "login.html"
UPLOAD_DIR = BASE_DIR / "uploads"
ALLOWED_IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
SESSION_COOKIE = "balancer_session"
SESSION_TTL = 7 * 24 * 60 * 60
password_hasher = PasswordHasher()


class ActivityTask(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=5000)
    images: list[str] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("任务名称不能为空")
        return value


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
    tasks: list[ActivityTask] = Field(default_factory=list, max_length=50)

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


class ActivityTasksInput(BaseModel):
    tasks: list[ActivityTask] = Field(default_factory=list, max_length=50)


class ActivityRecordInput(BaseModel):
    activity_id: str
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=5000)
    images: list[str] = Field(default_factory=list, max_length=30)
    published: bool = False

    @field_validator("title")
    @classmethod
    def strip_record_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("记录标题不能为空")
        return value

    @field_validator("images")
    @classmethod
    def validate_images(cls, value: list[str]) -> list[str]:
        if any(not re.fullmatch(r"/uploads/[a-zA-Z0-9._-]+", image) for image in value):
            raise ValueError("图片地址无效")
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


class CredentialsInput(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[a-z0-9_@.-]+", value):
            raise ValueError("账号只能包含字母、数字、下划线、点、短横线或 @")
        return value


class LoginInput(CredentialsInput):
    pass


class ProfileInput(BaseModel):
    real_name: str = Field(max_length=50)
    student_id: str = Field(max_length=50)
    college_major: str = Field(max_length=100)

    @field_validator("real_name", "student_id", "college_major")
    @classmethod
    def strip_profile(cls, value: str) -> str:
        return value.strip()


class MemberRoleInput(BaseModel):
    role: Literal["member", "user", "core", "admin"]


def session_key(token: str) -> str:
    return f"session:{hashlib.sha256(token.encode()).hexdigest()}"


def public_user(document: dict) -> dict:
    return {
        "id": str(document["_id"]), "username": document["username"], "role": document["role"],
        "real_name": document.get("real_name", ""),
        "student_id": document.get("student_id", ""),
        "college_major": document.get("college_major", ""),
    }


def get_user_collection(request: Request) -> Collection:
    return request.app.state.database.users


Users = Annotated[Collection, Depends(get_user_collection)]


def get_current_user(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="请先登录")
    user_id = request.app.state.redis.get(session_key(token))
    if not user_id:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    user = request.app.state.database.users.find_one({"_id": ObjectId(user_id)})
    if user is None or user.get("disabled", False):
        request.app.state.redis.delete(session_key(token))
        raise HTTPException(status_code=401, detail="账号不可用，请重新登录")
    return user


CurrentUser = Annotated[dict, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> dict:
    if user.get("role") not in ("user", "core", "admin"):
        raise HTTPException(status_code=403, detail="没有后台权限")
    return user


AdminUser = Annotated[dict, Depends(require_admin)]


def set_session(response: Response, request: Request, user: dict) -> None:
    token = secrets.token_urlsafe(32)
    request.app.state.redis.setex(session_key(token), SESSION_TTL, str(user["_id"]))
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_TTL,
        httponly=True,
        samesite="lax",
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        path="/",
    )


def clear_session(response: Response, request: Request) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        request.app.state.redis.delete(session_key(token))
    response.delete_cookie(SESSION_COOKIE, path="/")


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
        result["tasks"] = document.get("tasks", [])
        result["incentive_details"] = document.get("incentive_details", "")
        result["incentive_images"] = document.get("incentive_images", [])
    return result


def serialize_record(document: dict, activity_title: str) -> dict:
    return {
        "id": str(document["_id"]),
        "activity_id": str(document["activity_id"]),
        "activity_title": activity_title,
        "title": document["title"],
        "description": document["description"],
        "images": document["images"],
        "published": document["published"],
        "created_at": document["created_at"],
    }


def get_collection(request: Request) -> Collection:
    return request.app.state.database.activities


def get_categories(request: Request) -> Collection:
    return request.app.state.database.categories


def get_records(request: Request) -> Collection:
    return request.app.state.database.activity_records


Activities = Annotated[Collection, Depends(get_collection)]
Categories = Annotated[Collection, Depends(get_categories)]
Records = Annotated[Collection, Depends(get_records)]

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
    database.activity_records.create_index([("created_at", DESCENDING)])
    database.activity_records.create_index("activity_id")
    database.categories.create_index("name", unique=True)
    database.users.create_index("username", unique=True)
    if database.categories.count_documents({}) == 0:
        seeded_at = datetime.now(timezone.utc)
        database.categories.insert_many(
            [{"name": name, "created_at": seeded_at} for name in DEFAULT_CATEGORIES]
        )
    admin_username = os.getenv("ADMIN_USERNAME", "").strip().lower()
    admin_password = os.getenv("ADMIN_PASSWORD", "")
    if admin_username and admin_password and database.users.count_documents({}) == 0:
        database.users.insert_one(
            {
                "username": admin_username,
                "password_hash": password_hasher.hash(admin_password),
                "role": "admin",
                "disabled": False,
                "registered_activities": [],
                "created_at": datetime.now(timezone.utc),
            }
        )
    app.state.database = database
    app.state.redis = Redis(
        host=os.getenv("REDIS_HOST") or "redis",
        port=int(os.getenv("REDIS_PORT", "6379")),
        decode_responses=True,
    )
    app.state.redis.ping()
    yield
    app.state.redis.close()
    client.close()


app = FastAPI(title="Maker 开源硬件社 · 活动管理", lifespan=lifespan)


@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: CredentialsInput, users: Users) -> dict:
    if users.count_documents({"username": payload.username}):
        raise HTTPException(status_code=409, detail="该账号已存在")
    document = {
        "username": payload.username,
        "password_hash": password_hasher.hash(payload.password),
        "role": "member",
        "disabled": False,
        "registered_activities": [],
        "created_at": datetime.now(timezone.utc),
    }
    try:
        document["_id"] = users.insert_one(document).inserted_id
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="该账号已存在") from None
    return public_user(document)


@app.post("/api/auth/login")
def login(payload: LoginInput, users: Users, request: Request, response: Response) -> dict:
    user = users.find_one({"username": payload.username})
    if user is None or user.get("disabled", False):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    try:
        password_hasher.verify(user["password_hash"], payload.password)
    except (InvalidHashError, VerificationError, VerifyMismatchError):
        raise HTTPException(status_code=401, detail="账号或密码错误") from None
    set_session(response, request, user)
    return public_user(user)


@app.get("/api/auth/me")
def current_user(user: CurrentUser) -> dict:
    return public_user(user)


@app.put("/api/auth/profile")
def update_profile(payload: ProfileInput, user: CurrentUser, users: Users) -> dict:
    fields = payload.model_dump()
    users.update_one({"_id": user["_id"]}, {"$set": fields})
    return public_user({**user, **fields})


@app.get("/api/admin/members")
def list_members(_: AdminUser, users: Users) -> list[dict]:
    return [
        {
            "id": str(user["_id"]),
            "username": user["username"],
            "role": user["role"],
            "real_name": user.get("real_name", ""),
            "student_id": user.get("student_id", ""),
            "college_major": user.get("college_major", ""),
            "created_at": user["created_at"],
        }
        for user in users.find({}, {"username": 1, "role": 1, "real_name": 1, "student_id": 1,
                                "college_major": 1, "created_at": 1})
        .sort("created_at", DESCENDING)
    ]


@app.put("/api/admin/members/{member_id}/role")
def update_member_role(member_id: str, payload: MemberRoleInput, admin: AdminUser, users: Users) -> dict:
    if admin["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅系统管理员可修改成员身份")
    member = users.find_one({"_id": object_id_or_404(member_id, "成员不存在")})
    if member is None:
        raise HTTPException(status_code=404, detail="成员不存在")
    if member["_id"] == admin["_id"] and payload.role != "admin":
        raise HTTPException(status_code=409, detail="不能取消自己的管理员身份")
    users.update_one({"_id": member["_id"]}, {"$set": {"role": payload.role}})
    return {"id": str(member["_id"]), "role": payload.role}


@app.get("/api/auth/activities")
def my_activities(user: CurrentUser, activities: Activities) -> list[dict]:
    result = []
    completed = set(user.get("completed_tasks", []))
    for activity in activities.find(
        {"_id": {"$in": user.get("registered_activities", [])}}
    ).sort("start_time", ASCENDING):
        item = serialize_activity(activity, public=True)
        item["tasks"] = [
            {**task, "completed": task["id"] in completed}
            for task in activity.get("tasks", [])
        ]
        result.append(item)
    return result


@app.put("/api/auth/activities/{activity_id}/tasks/{task_id}")
def complete_task(activity_id: str, task_id: str, completed: bool, user: CurrentUser,
                  activities: Activities, users: Users) -> dict:
    activity_obj = object_id_or_404(activity_id)
    activity = activities.find_one({"_id": activity_obj})
    if activity_obj not in user.get("registered_activities", []) or activity is None:
        raise HTTPException(status_code=404, detail="报名活动不存在")
    if activity["status"] == "已取消" or activity["end_time"] <= datetime.now(timezone.utc).replace(tzinfo=None):
        raise HTTPException(status_code=409, detail="活动已结束或取消")
    if not any(task["id"] == task_id for task in activity.get("tasks", [])):
        raise HTTPException(status_code=404, detail="任务不存在")
    operation = {"$addToSet": {"completed_tasks": task_id}} if completed else {"$pull": {"completed_tasks": task_id}}
    users.update_one({"_id": user["_id"]}, operation)
    return {"completed": completed}


@app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request) -> Response:
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session(response, request)
    return response


@app.get("/api/activities", response_model=ActivityPage)
def list_activities(
    _: AdminUser,
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


@app.get("/api/public/records", response_model=ActivityPage)
def public_records(activities: Activities, records: Records,
                   page: int = Query(default=1, ge=1),
                   page_size: int = Query(default=6, ge=1, le=30)) -> ActivityPage:
    activity_names = {item["_id"]: item["title"] for item in activities.find(
        {"status": {"$in": ["报名中", "进行中", "已结束"]}}, {"title": 1}
    )}
    filters = {"published": True, "activity_id": {"$in": list(activity_names)}}
    total = records.count_documents(filters)
    cursor = records.find(filters).sort("created_at", DESCENDING).skip((page - 1) * page_size).limit(page_size)
    return ActivityPage(items=[serialize_record(item, activity_names[item["activity_id"]]) for item in cursor],
                        total=total, page=page, page_size=page_size)


@app.get("/api/records", response_model=ActivityPage)
def list_records(_: AdminUser, activities: Activities, records: Records,
                 page: int = Query(default=1, ge=1),
                 page_size: int = Query(default=20, ge=1, le=100)) -> ActivityPage:
    total = records.count_documents({})
    cursor = records.find().sort("created_at", DESCENDING).skip((page - 1) * page_size).limit(page_size)
    items = list(cursor)
    activity_names = {item["_id"]: item["title"] for item in activities.find(
        {"_id": {"$in": [item["activity_id"] for item in items]}}, {"title": 1}
    )}
    return ActivityPage(items=[serialize_record(item, activity_names.get(item["activity_id"], "已删除的活动"))
                               for item in items], total=total, page=page, page_size=page_size)


@app.post("/api/records", status_code=status.HTTP_201_CREATED)
def create_record(payload: ActivityRecordInput, _: AdminUser, activities: Activities, records: Records) -> dict:
    activity_id = object_id_or_404(payload.activity_id)
    activity = activities.find_one({"_id": activity_id})
    if activity is None:
        raise HTTPException(status_code=404, detail="活动不存在")
    document = payload.model_dump(exclude={"activity_id"})
    document.update(activity_id=activity_id, created_at=datetime.now(timezone.utc))
    document["_id"] = records.insert_one(document).inserted_id
    return serialize_record(document, activity["title"])


@app.put("/api/records/{record_id}")
def update_record(record_id: str, payload: ActivityRecordInput, _: AdminUser,
                  activities: Activities, records: Records) -> dict:
    activity_id = object_id_or_404(payload.activity_id)
    activity = activities.find_one({"_id": activity_id})
    if activity is None:
        raise HTTPException(status_code=404, detail="活动不存在")
    update = payload.model_dump(exclude={"activity_id"})
    update["activity_id"] = activity_id
    document = records.find_one_and_update({"_id": object_id_or_404(record_id, "记录不存在")},
                                           {"$set": update}, return_document=True)
    if document is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    return serialize_record(document, activity["title"])


@app.delete("/api/records/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_record(record_id: str, _: AdminUser, records: Records) -> Response:
    result = records.delete_one({"_id": object_id_or_404(record_id, "记录不存在")})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="记录不存在")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/activities/summary")
def activity_summary(_: AdminUser, activities: Activities) -> dict[str, int]:
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
def get_activity(activity_id: str, _: AdminUser, activities: Activities) -> dict:
    document = activities.find_one({"_id": object_id_or_404(activity_id)})
    if document is None:
        raise HTTPException(status_code=404, detail="活动不存在")
    return serialize_activity(document)


@app.put("/api/activities/{activity_id}/tasks")
def update_activity_tasks(
    activity_id: str,
    payload: ActivityTasksInput,
    _: AdminUser,
    activities: Activities,
) -> dict:
    document = activities.find_one_and_update(
        {"_id": object_id_or_404(activity_id)},
        {"$set": {"tasks": [task.model_dump() for task in payload.tasks], "updated_at": datetime.now(timezone.utc)}},
        return_document=True,
    )
    if document is None:
        raise HTTPException(status_code=404, detail="活动不存在")
    return {"tasks": document.get("tasks", [])}


@app.post("/api/public/activities/{activity_id}/register", status_code=status.HTTP_201_CREATED)
def register_activity(activity_id: str, user: CurrentUser, activities: Activities, users: Users) -> dict:
    activity_id_obj = object_id_or_404(activity_id)
    activity = activities.find_one({"_id": activity_id_obj})
    if activity is None:
        raise HTTPException(status_code=404, detail="活动不存在")
    if activity["status"] != "报名中" or activity["end_time"] <= datetime.now(timezone.utc).replace(tzinfo=None):
        raise HTTPException(status_code=409, detail="该活动暂不接受报名")
    if activity_id_obj in user.get("registered_activities", []):
        raise HTTPException(status_code=409, detail="你已报名该活动")
    if users.count_documents({"registered_activities": activity_id_obj}) >= activity["capacity"]:
        raise HTTPException(status_code=409, detail="活动名额已满")
    result = users.update_one(
        {"_id": user["_id"], "registered_activities": {"$ne": activity_id_obj}},
        {"$addToSet": {"registered_activities": activity_id_obj}},
    )
    if not result.modified_count:
        raise HTTPException(status_code=409, detail="你已报名该活动")
    return {
        "incentive_details": activity.get("incentive_details", ""),
        "incentive_images": activity.get("incentive_images", []),
    }


@app.post("/api/activities", status_code=status.HTTP_201_CREATED)
def create_activity(payload: ActivityInput, _: AdminUser, activities: Activities, categories: Categories) -> dict:
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
def update_activity(
    activity_id: str,
    payload: ActivityInput,
    _: AdminUser,
    activities: Activities,
    categories: Categories,
) -> dict:
    require_category(categories, payload.category)
    if payload.end_time <= payload.start_time:
        raise HTTPException(status_code=422, detail="结束时间必须晚于开始时间")
    update = payload.model_dump(exclude={"tasks"})
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
def delete_activity(activity_id: str, _: AdminUser, activities: Activities, records: Records) -> Response:
    result = activities.delete_one({"_id": object_id_or_404(activity_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="活动不存在")
    records.delete_many({"activity_id": ObjectId(activity_id)})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/categories")
def list_categories(_: AdminUser, activities: Activities, categories: Categories) -> list[dict]:
    return [
        serialize_category(item, activities.count_documents({"category": item["name"]}))
        for item in categories.find().sort("created_at", ASCENDING)
    ]


@app.post("/api/categories", status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryInput, _: AdminUser, categories: Categories) -> dict:
    if categories.count_documents({"name": payload.name}):
        raise HTTPException(status_code=409, detail="该类别已存在")
    document = {"name": payload.name, "created_at": datetime.now(timezone.utc)}
    document["_id"] = categories.insert_one(document).inserted_id
    return serialize_category(document, 0)


@app.put("/api/categories/{category_id}")
def rename_category(
    category_id: str,
    payload: CategoryInput,
    _: AdminUser,
    activities: Activities,
    categories: Categories,
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
def delete_category(
    category_id: str, _: AdminUser, activities: Activities, categories: Categories
) -> Response:
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
async def upload_image(_: AdminUser, image: Annotated[UploadFile, File()]) -> dict[str, str]:
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


@app.get("/login", include_in_schema=False)
def login_page() -> FileResponse:
    return FileResponse(LOGIN_FILE)


@app.get("/space", include_in_schema=False)
def member_space() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "space.html")


@app.get("/admin", include_in_schema=False)
def admin() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/admin/tasks", include_in_schema=False)
def admin_tasks() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "tasks.html")


@app.get("/admin/records", include_in_schema=False)
def admin_records() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "records.html")


@app.get("/admin/members", include_in_schema=False)
def admin_members() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "members.html")


UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")