# app.py
import os
import json
import random
from uuid import uuid4
from datetime import datetime, timezone
from flask import Flask, request, jsonify, render_template, send_from_directory
from supabase import create_client, Client

#export SUPABASE_URL="https://xdbavzzcoautleoylvoh.supabase.co"
#export SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkYmF2enpjb2F1dGxlb3lsdm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4NTQ4MTAsImV4cCI6MjA3MzQzMDgxMH0.oocBIHHm59y54_kLaUTCSx0NC6l2Bh63FC1ttxaHCIk"
# Config
QUIZ_DURATION_MIN = 25
POOL_PATH = "questions.json"

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Set SUPABASE_URL and SUPABASE_KEY environment variables before running.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = Flask(__name__, static_folder='static', template_folder='templates')


# Load pool once (server restart required to reload)
def load_pool():
    with open(POOL_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


QUESTION_POOL = load_pool()

REQ_DISTRIBUTION = {
    "decode": 2,
    "phishing": 3,
    "spotvul": 2,
    "hygiene": 2,
    "digitalfootprint": 1
}


def pick_questions(pool):
    bycat = {}
    for q in pool:
        bycat.setdefault(q['category'], []).append(q)
    picked = []
    for cat, cnt in REQ_DISTRIBUTION.items():
        candidates = bycat.get(cat, [])
        if len(candidates) < cnt:
            raise ValueError(f"Not enough questions in category {cat}: need {cnt}, have {len(candidates)}")
        picked += random.sample(candidates, cnt)
    random.shuffle(picked)
    return picked


# Remove answer from questions returned to client
def sanitize_questions(qs):
    sanitized = []
    for q in qs:
        qcopy = {k: v for k, v in q.items() if k != 'answer'}
        sanitized.append(qcopy)
    return sanitized


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/start', methods=['POST'])
def start():
    body = request.json or {}
    team = (body.get('team') or "").strip()
    if not team:
        return jsonify({"error": "team name required"}), 400

    try:
        selected = pick_questions(QUESTION_POOL)
    except ValueError as e:
        return jsonify({"error": str(e)}), 500

    session_id = str(uuid4())
    start_time = datetime.now(timezone.utc).isoformat()
    qids = [q['id'] for q in selected]

    # Insert into Supabase table: quiz_sessions
    payload = {
        "session_id": session_id,
        "team_name": team,
        "start_time": start_time,
        "duration_min": QUIZ_DURATION_MIN,
        "question_ids": qids,
        "answers": {},  # to be updated at submit
        "status": "ongoing"
    }
    res = supabase.table("quiz_sessions").insert(payload).execute()

    # Return sanitized questions
    return jsonify({
        "session_id": session_id,
        "start_time": start_time,
        "duration_min": QUIZ_DURATION_MIN,
        "questions": sanitize_questions(selected)
    })


@app.route('/submit', methods=['POST'])
def submit():
    body = request.json or {}
    session_id = body.get('session_id')
    answers = body.get('answers', {})

    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    # fetch session from supabase
    res = supabase.table("quiz_sessions").select("*").eq("session_id", session_id).limit(1).execute()
    data = res.data if hasattr(res, "data") else res[0] if isinstance(res, list) else res.get("data", [])

    if not data:
        return jsonify({"error": "session not found"}), 404

    session = data[0]
    start_time = datetime.fromisoformat(session['start_time'])
    now = datetime.now(timezone.utc)
    elapsed = (now - start_time).total_seconds()
    allowed = QUIZ_DURATION_MIN * 60
    timed_out = elapsed > allowed
    time_taken = int(min(elapsed, allowed))

    # Build a mapping of id -> question object for grading
    pool_by_id = {q['id']: q for q in QUESTION_POOL}

    attempted = 0
    correct = 0
    for qid_str, sel in answers.items():
        try:
            qid = int(qid_str)
        except:
            continue
        q = pool_by_id.get(qid)
        if q is None:
            continue
        if sel is None:
            continue
        attempted += 1
        if int(sel) == int(q['answer']):
            correct += 1

    status = "timed_out" if timed_out else "finished"
    finish_time = now.isoformat()

    update_payload = {
        "answers": answers,
        "attempted": attempted,
        "correct": correct,
        "time_taken_seconds": time_taken,
        "status": status,
        "finish_time": finish_time
    }
    supabase.table("quiz_sessions").update(update_payload).eq("session_id", session_id).execute()

    return jsonify({
        "attempted": attempted,
        "correct": correct,
        "time_taken_seconds": time_taken,
        "timed_out": timed_out
    })


@app.route('/leaderboard', methods=['GET'])
def leaderboard():
    res = supabase.table("quiz_sessions").select(
        "team_name, correct, attempted, time_taken_seconds, finish_time"
    ).order("correct", desc=True).limit(50).execute()

    data = res.data if hasattr(res, "data") else res[0] if isinstance(res, list) else res.get("data", [])
    return jsonify(data)


@app.route('/static/<path:fn>')
def static_files(fn):
    return send_from_directory('static', fn)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
