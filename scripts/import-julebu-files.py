#!/usr/bin/env python3
"""句乐部课程包文件导入脚本（高性能版 — 使用纯 SQL 批处理）"""
import json, os, sys, subprocess, uuid, time, re

DATA_DIR = os.path.join(os.path.dirname(__file__) or ".", "..", ".data", "julebu")
MYSQL_URI = None

# Load .env.local
env_path = os.path.join(os.path.dirname(__file__) or ".", "..", ".env.local")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                MYSQL_URI = line[len("DATABASE_URL="):].strip().strip('"').strip("'")

BATCH_SIZE = int(os.environ.get("JULEBU_BATCH", "500"))


def parse_mysql_uri(uri):
    """mysql://user:pass@host:port/dbname"""
    import urllib.parse
    parsed = urllib.parse.urlparse(uri)
    return {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 3306,
        "user": parsed.username or "root",
        "password": parsed.password or "",
        "db": parsed.path.lstrip("/"),
    }


def escape(val):
    """Escape a value for MySQL (simple version)"""
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "1" if val else "0"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val)
    s = s.replace("\\", "\\\\")
    s = s.replace("'", "\\'")
    s = s.replace("\n", "\\n")
    s = s.replace("\r", "\\r")
    return "'" + s + "'"


def to_mysql_json(val):
    """Convert a Python value to a MySQL JSON string"""
    if val is None:
        return "NULL"
    return "'" + json.dumps(val, ensure_ascii=False).replace("'", "\\'").replace("\\", "\\\\") + "'"


def run_sql(cfg, sql, db=None):
    """Run a SQL statement via mysql CLI"""
    cmd = [
        "mysql",
        "-h", cfg["host"],
        "-P", str(cfg["port"]),
        "-u", cfg["user"],
    ]
    if cfg["password"]:
        cmd.extend(["-p" + cfg["password"]])
    cmd.append(cfg["db"])
    
    proc = subprocess.run(
        cmd,
        input=sql.encode("utf-8"),
        capture_output=True,
        timeout=300,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace")
        if stderr.strip():
            print(f"  SQL Error: {stderr[:200]}")
            print(f"  (SQL snippet: {sql[:200]})")
            return False
    return True


def main():
    if not MYSQL_URI:
        print("❌ DATABASE_URL not found in .env.local")
        sys.exit(1)

    cfg = parse_mysql_uri(MYSQL_URI)
    print(f"🔌 Connecting to MySQL at {cfg['host']}:{cfg['port']}/{cfg['db']}\n")

    # List files
    all_files = sorted([
        f for f in os.listdir(DATA_DIR)
        if f.endswith(".json")
        and not f.startswith("sentences-")
        and f not in ("all-packs.json", "packs-metadata.json")
    ])

    print(f"📁 Found {len(all_files)} course pack files\n")

    # Get existing course titles
    result = subprocess.run(
        ["mysql", "-h", cfg["host"], "-P", str(cfg["port"]), "-u", cfg["user"],
         "-p" + cfg["password"], cfg["db"], "-e",
         "SELECT title FROM courses WHERE source_name = '句乐部'"],
        capture_output=True, text=True, timeout=30,
    )
    existing_titles = set()
    for line in result.stdout.strip().split("\n")[1:]:
        if line.strip():
            existing_titles.add(line.strip())

    print(f"📊 {len(existing_titles)} existing courses from 句乐部 in DB\n")

    imported = skipped = failed = 0
    total_lessons = total_sentences = 0

    for fn in all_files:
        file_path = os.path.join(DATA_DIR, fn)

        # Parse JSON
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                pack = json.load(f)
        except Exception as e:
            print(f"  ✗ {fn}: parse error — {e}")
            failed += 1
            continue

        if not pack.get("title") or not isinstance(pack.get("courses"), list) or not pack["courses"]:
            print(f"  ⚠ {fn}: no title or courses, skipping")
            skipped += 1
            continue

        if pack["title"] in existing_titles:
            print(f"  ⏭ {pack['title']}: already exists")
            skipped += 1
            continue

        course_id = str(uuid.uuid4())

        # Build SQL batch
        sql_parts = [
            f"INSERT INTO courses (id, title, description, source, source_name, learner_count, usage_count, is_published) "
            f"VALUES ({escape(course_id)}, {escape(pack['title'])}, {escape(pack.get('description') or pack['title'])}, 'official', '句乐部', 0, 0, 1);"
        ]

        lesson_count = 0
        sentence_count = 0
        value_rows = []
        value_lesson_ids = []

        for jcourse in pack["courses"]:
            if not isinstance(jcourse, dict) or not jcourse.get("title"):
                continue
            lesson_id = str(uuid.uuid4())
            value_lesson_ids.append(lesson_id)

            sql_parts.append(
                f"INSERT INTO lessons (id, course_id, title, summary, sort_order) "
                f"VALUES ({escape(lesson_id)}, {escape(course_id)}, {escape(jcourse['title'])}, '', {jcourse.get('order', 0)});"
            )
            lesson_count += 1

            sentences_data = jcourse.get("sentences") or []
            for s in sentences_data:
                sent_id = str(uuid.uuid4())
                words = None
                if s.get("wordDetails"):
                    words = [
                        {"english": w["word"], "chinese": w.get("definition"), "phonetic": w.get("phonetic"), "pos": w.get("pos")}
                        for w in s["wordDetails"] if isinstance(w, dict)
                    ]
                dep = s.get("dependencyAnalysis")
                struct = s.get("sentenceStructure")
                
                cols = ["id", "chinese", "english", "lesson_id", "sort_order", "words", "dependency_analysis", "sentence_structure"]
                vals = [
                    escape(sent_id),
                    escape(s.get("chinese", "")),
                    escape(s.get("english", "")),
                    escape(lesson_id),
                    int(s.get("sortOrder", 0)),
                    to_mysql_json(words),
                    to_mysql_json(dep),
                    to_mysql_json(struct),
                ]
                value_rows.append(f"({','.join(str(v) for v in vals)})")
                sentence_count += 1

                if len(value_rows) >= BATCH_SIZE:
                    sql_parts.append(
                        f"INSERT INTO sentences ({','.join(cols)}) VALUES\n" + ",\n".join(value_rows) + ";"
                    )
                    value_rows = []

        if value_rows:
            sql_parts.append(
                f"INSERT INTO sentences ({','.join(cols)}) VALUES\n" + ",\n".join(value_rows) + ";"
            )
            value_rows = []

        if lesson_count == 0:
            print(f"  ⚠ {pack['title']}: 0 lessons with data, skipping")
            skipped += 1
            # Need to undo the course insert by running it in a transaction
            # Since we're using mysql CLI, let's remove the course insert too
            sql_parts = []
            # Actually let's just not create empty courses / skip
            continue

        # Run all SQL
        full_sql = "\n".join(sql_parts)
        ok = run_sql(cfg, full_sql)
        if not ok:
            print(f"  ✗ {pack['title']}: SQL error, skipping")
            failed += 1
            continue

        existing_titles.add(pack["title"])
        imported += 1
        total_lessons += lesson_count
        total_sentences += sentence_count
        print(f"  ✓ {pack['title']}: {lesson_count} lessons, {sentence_count} sentences")

    print(f"\n✅ 完成！")
    print(f"   导入: {imported} 个课程包, {total_lessons} 课, {total_sentences} 句")
    print(f"   跳过: {skipped} (已存在/无效)")
    if failed:
        print(f"   失败: {failed}")


if __name__ == "__main__":
    main()
