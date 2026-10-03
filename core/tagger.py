"""Rule-based auto tagging for downloaded tweets.

The rules live in config/tag_rules.json so the taxonomy can be edited without
touching code. Each category is scored by how many of its keywords appear in the
tweet text / author name; the top N categories become tags. Media kind and
language tags are always added so every post lands somewhere.
"""
from __future__ import annotations

import json
import re
from collections import Counter

from .config import TAG_RULES_PATH

DEFAULT_RULES: dict = {
    "version": 1,
    "categories": {
        "AI": {
            "color": "#8b5cf6",
            "keywords": [
                "artificial intelligence", "openai", "chatgpt", "gpt-4", "gpt-5",
                "claude", "anthropic", "gemini", "deepseek", "llm", "大模型",
                "机器学习", "深度学习", "神经网络", "人工智能", "stable diffusion",
                "midjourney", "sora", "runway", "ai agent", "copilot", "hugging face",
                "mistral", "llama", "grok", "text-to-video", "文生视频", "agi",
            ],
        },
        "科技": {
            "color": "#3b82f6",
            "keywords": [
                "technology", "tech", "科技", "数码", "gadget", "iphone", "android",
                "apple", "google", "microsoft", "nvidia", "amd", "intel", "芯片",
                "半导体", "chip", "硅谷", "startup", "创业公司", "软件", "开源",
                "open source", "linux", "macos", "windows", "robotics", "机器人",
                "quantum computing", "量子计算", "5g", "6g", "cloud", "云计算",
            ],
        },
        "太空": {
            "color": "#0ea5e9",
            "keywords": [
                "space", "spacex", "nasa", "rocket", "火箭", "卫星", "satellite",
                "mars", "火星", "月球", "moon", "launch", "falcon", "starship",
                "starship", "orbit", "轨道", "astronaut", "宇航员", "telescope",
                "望远镜", "galaxy", "星系", "space station", "空间站", "天文",
            ],
        },
        "财经": {
            "color": "#22c55e",
            "keywords": [
                "market", "stock", "股票", "股市", "economy", "经济", "inflation",
                "通胀", "fed", "美联储", "财报", "earnings", "revenue", "营收",
                "nasdaq", "s&p", "道琼斯", "investor", "投资者", "估值", "ipo",
                "gdp", "recession", "衰退", "关税", "tariff", "贸易",
            ],
        },
        "加密货币": {
            "color": "#f97316",
            "keywords": [
                "bitcoin", "btc", "ethereum", "eth", "crypto", "加密货币", "比特币",
                "以太坊", "solana", "sol", "defi", "nft", "web3", "blockchain",
                "区块链", "稳定币", "stablecoin", "binance", "coinbase", "矿工",
                "altcoin", "加密市场", "on-chain", "链上",
            ],
        },
        "游戏": {
            "color": "#a855f7",
            "keywords": [
                "game", "gaming", "游戏", "steam", "playstation", "xbox", "nintendo",
                "任天堂", "switch", "fps", "esports", "电竞", "手游", "手游",
                "minecraft", "fortnite", "valorant", "league of legends", "英雄联盟",
                "boss fight", "speedrun", "gameplay", "实况", "开局", "gta", "任天堂",
            ],
        },
        "影视": {
            "color": "#ec4899",
            "keywords": [
                "movie", "film", "电影", "trailer", "预告", "netflix", "剧集",
                "series", "anime", "动漫", "动画", "番剧", "cinema", "电影院",
                "documentary", "纪录片", "season", "episode", "hbo", "disney",
                "漫威", "marvel", "dc", "票房", "box office", "导演", "actor",
            ],
        },
        "音乐": {
            "color": "#14b8a6",
            "keywords": [
                "music", "音乐", "song", "album", "专辑", "concert", "演唱会",
                "remix", "dj", "beat", "spotify", "billboard", "歌手", "单曲",
                "live performance", "现场", "吉他", "guitar", "piano", "钢琴",
                "rap", "hip hop", "摇滚", "rock band", "kpop", "ost",
            ],
        },
        "体育": {
            "color": "#eab308",
            "keywords": [
                "sport", "体育", "nba", "nfl", "football", "soccer", "足球", "篮球",
                "olympics", "奥运", "f1", "formula 1", "ufc", "mma", "goal", "进球",
                "champion", "冠军", "match", "比赛", "球员", "player", "球赛",
                "tennis", "网球", "棒球", "mlb", "world cup", "世界杯",
            ],
        },
        "搞笑": {
            "color": "#fb7185",
            "keywords": [
                "lol", "funny", "meme", "搞笑", "沙雕", "梗", "humor", "comedy",
                "笑死", "哈哈哈哈", "lmao", "wtf", "hilarious", "prank", "整蛊",
                "fail", "翻车", "尴尬", "哈哈", "🤣", "😂", "joke",
            ],
        },
        "时事": {
            "color": "#64748b",
            "keywords": [
                "breaking", "news", "新闻", "时事", "报道", "report", "突发",
                "记者", "reuters", "associated press", "头条", "headline",
                "刚刚", "最新消息", "发布会", "press conference",
            ],
        },
        "政治": {
            "color": "#dc2626",
            "keywords": [
                "politics", "政治", "election", "选举", "总统", "president",
                "government", "政府", "国会", "congress", "senate", "trump",
                "特朗普", "biden", "拜登", "campaign", "竞选", "policy", "政策",
                "投票", "vote", "parliament", "议会", "法案",
            ],
        },
        "军事": {
            "color": "#78716c",
            "keywords": [
                "military", "军事", "army", "军队", "war", "战争", "战机",
                "fighter jet", "missile", "导弹", "海军", "navy", "drone", "无人机",
                "坦克", "tank", "defense", "国防", "aircraft carrier", "航母",
                "乌克兰", "ukraine", "俄罗斯", "russia", "以色列", "israel",
            ],
        },
        "科学": {
            "color": "#06b6d4",
            "keywords": [
                "science", "科学", "research", "研究", "physics", "物理",
                "chemistry", "生物", "biology", "quantum", "论文", "study",
                "experiment", "实验", "发现", "discovery", "nature", "cell",
                "基因", "dna", "化石", "fossil", "考古", "archaeology",
            ],
        },
        "健康": {
            "color": "#10b981",
            "keywords": [
                "health", "健康", "medical", "医学", "doctor", "医生", "vaccine",
                "疫苗", "疾病", "disease", "fitness", "健身", "锻炼", "营养",
                "nutrition", "睡眠", "sleep", "mental health", "心理健康", "医院",
                "surgery", "手术", "药物", "drug",
            ],
        },
        "美食": {
            "color": "#f59e0b",
            "keywords": [
                "food", "美食", "recipe", "食谱", "cooking", "料理", "restaurant",
                "餐厅", "好吃", "下厨", "baking", "烘焙", "coffee", "咖啡",
                "dessert", "甜点", "noodle", "面", "steak", "牛排", "chef", "厨师",
            ],
        },
        "旅行": {
            "color": "#38bdf8",
            "keywords": [
                "travel", "旅行", "tourism", "旅游", "风景", "beach", "海滩",
                "山", "mountain", "城市", "city", "hotel", "酒店", "航班",
                "flight", "visa", "签证", "backpacking", "自驾", "road trip",
                "日本", "japan", "巴黎", "paris", "海岛", "风景",
            ],
        },
        "汽车": {
            "color": "#ef4444",
            "keywords": [
                "car", "汽车", "tesla", "特斯拉", "ev", "电动车", "driving",
                "驾驶", "byd", "比亚迪", "跑车", "supercar", "引擎", "engine",
                "自动驾驶", "autopilot", "fsd", "充电", "续航", "蔚来", "小鹏",
            ],
        },
        "动物": {
            "color": "#84cc16",
            "keywords": [
                "cat", "猫", "dog", "狗", "animal", "动物", "宠物", "pet",
                "bird", "鸟", "wildlife", "野生动物", "熊猫", "panda", "cute",
                "萌", "puppy", "kitten", "zoo", "动物园", "海洋生物", "鲸",
            ],
        },
        "设计": {
            "color": "#d946ef",
            "keywords": [
                "design", "设计", "ui", "ux", "illustration", "插画", "typography",
                "字体", "art", "艺术", "摄影", "photography", "画家", "painter",
                "3d render", "blender", "photoshop", "logo", "配色", "视觉",
                "architecture", "建筑", "海报", "poster",
            ],
        },
        "教程": {
            "color": "#0891b2",
            "keywords": [
                "tutorial", "教程", "how to", "教学", "guide", "指南", "tips",
                "技巧", "walkthrough", "step by step", "手把手", "干货",
                "入门", "从零开始", "learn", "学习", "讲解", "拆解", "分享",
            ],
        },
        "职场": {
            "color": "#a16207",
            "keywords": [
                "career", "职场", "job", "工作", "hiring", "招聘", "interview",
                "面试", "resume", "简历", "salary", "薪资", "裁员", "layoff",
                "远程办公", "remote work", "manager", "老板", "同事", "升职",
            ],
        },
        "教育": {
            "color": "#4f46e5",
            "keywords": [
                "education", "教育", "school", "学校", "university", "大学",
                "考试", "exam", "student", "学生", "teacher", "老师", "课程",
                "course", "study abroad", "留学", "奖学金", "scholarship",
            ],
        },
        "购物": {
            "color": "#e879f9",
            "keywords": [
                "deal", "折扣", "优惠", "sale", "促销", "discount", "购买",
                "限定", "新品", "开箱", "unboxing", "测评", "review", "性价比",
                "亚马逊", "amazon", "淘宝", "黑五", "black friday",
            ],
        },
    },
}

HASHTAG_RE = re.compile(r"[#＃]([\w\u4e00-\u9fff]{1,30})")
URL_RE = re.compile(r"https?://\S+")
MENTION_RE = re.compile(r"@\w+")

CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def load_rules() -> dict:
    if not TAG_RULES_PATH.exists():
        TAG_RULES_PATH.write_text(
            json.dumps(DEFAULT_RULES, indent=2, ensure_ascii=False), "utf-8"
        )
        return DEFAULT_RULES
    try:
        data = json.loads(TAG_RULES_PATH.read_text("utf-8"))
        if "categories" in data and data["categories"]:
            return data
    except Exception:
        pass
    return DEFAULT_RULES


def save_rules(rules: dict) -> None:
    TAG_RULES_PATH.write_text(
        json.dumps(rules, indent=2, ensure_ascii=False), "utf-8"
    )


def clean_text(text: str) -> str:
    text = text or ""
    text = URL_RE.sub(" ", text)
    text = MENTION_RE.sub(" ", text)
    return text


def detect_language(text: str, lang: str | None = None) -> str | None:
    body = clean_text(text)
    if not body.strip():
        return lang
    cjk = len(CJK_RE.findall(body))
    latin = len(re.findall(r"[A-Za-z]", body))
    if cjk >= 4 and cjk * 3 >= latin:
        return "zh"
    if latin >= 8:
        return "en"
    return lang


def score_categories(text: str, author: str, rules: dict) -> Counter:
    haystack = f"{clean_text(text)} {author or ''}".lower()
    scores: Counter = Counter()
    for name, spec in rules.get("categories", {}).items():
        hits = set()
        for kw in spec.get("keywords", []):
            needle = kw.lower()
            if not needle:
                continue
            if needle.isascii():
                # word-boundary match for latin keywords, plain contains for CJK
                if re.search(r"(?<![a-z0-9])" + re.escape(needle) + r"(?![a-z0-9])", haystack):
                    hits.add(needle)
            elif needle in haystack:
                hits.add(needle)
        if hits:
            scores[name] = len(hits)
    return scores


def media_tags(media_kind: str, duration: float | None, height: int | None) -> list[str]:
    tags: list[str] = []
    if media_kind == "video":
        tags.append("视频")
        if duration is not None:
            if duration >= 300:
                tags.append("长视频")
            elif duration <= 60:
                tags.append("短视频")
    elif media_kind == "image":
        tags.append("图片")
    elif media_kind == "mixed":
        tags.append("视频")
        tags.append("图片")
    else:
        tags.append("纯文字")
    if height:
        if height >= 2160:
            tags.append("4K")
        elif height >= 1080:
            tags.append("1080P")
    return tags


def auto_tag(post: dict, rules: dict | None = None,
             max_tags: int = 6) -> list[tuple[str, float]]:
    """Return [(tag_name, score)] for one post."""
    rules = rules or load_rules()
    text = post.get("text") or ""
    author = post.get("author_handle") or post.get("author_name") or ""

    results: list[tuple[str, float]] = []
    scores = score_categories(text, author, rules)
    for name, score in scores.most_common(max_tags):
        results.append((name, float(score + 10)))  # category beats incidental tags

    # Hashtags the author already wrote are strong signals.
    for tag in HASHTAG_RE.findall(text)[:5]:
        tag = tag.strip()
        if tag:
            results.append((tag, 5.0))

    lang = detect_language(text, post.get("lang"))
    if lang == "zh":
        results.append(("中文", 3.0))
    elif lang == "en":
        results.append(("英文", 3.0))

    for tag in media_tags(post.get("media_kind") or "text",
                          post.get("duration"), post.get("height")):
        results.append((tag, 2.0))

    # de-duplicate, keep best score, stable order
    best: dict[str, float] = {}
    for name, score in results:
        if name not in best or score > best[name]:
            best[name] = score
    ordered = sorted(best.items(), key=lambda kv: (-kv[1], kv[0]))
    return ordered


def category_color(name: str, rules: dict | None = None) -> str | None:
    rules = rules or load_rules()
    spec = (rules.get("categories") or {}).get(name)
    return spec.get("color") if spec else None