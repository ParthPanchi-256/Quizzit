# Quizzit — Live Quiz Platform

## 🎥 Demo Video

[![Quizzit Demo Video](https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg)]([https://www.youtube.com/watch?v=dQw4w9WgXcQ](https://youtu.be/RgCkt_LDVR8?si=T5uYZAtBn0ruMq1o))
*(Click the image above to watch the demo video — replace the YouTube link and image URL with your actual video)*

---

A real-time quiz platform where educators create and host live MCQ quizzes, and students join rooms to compete with live leaderboards. Now powered by **AI Quiz Generation** and an enterprise-grade **Redis game engine**.

## ✨ Features

- **AI Quiz Generation** — Upload PDFs, PPTXs, or text prompts and have LangGraph/Groq AI automatically generate and verify your quiz.
- **Role-based Auth** — Sign up as Educator or Student with email verification.
- **Quiz Builder** — Create MCQ quizzes with 2-4 options, set time limits, publish.
- **Live Rooms** — Host rooms with a simple 6-digit code for instant, frictionless access.
- **Real-time Gameplay** — Synchronized questions, timed answers, instant feedback.
- **Scoring System** — Points for speed + correctness, streak bonuses.
- **Live Leaderboard** — Updates after each question.
- **Redis Game State** — Highly concurrent, lock-safe game engine for flawless multiplayer action.

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite |
| Backend | Node.js + Express |
| AI Microservice | Python + FastAPI + LangGraph |
| Database | PostgreSQL |
| Game State | Redis + Socket.IO |
| Orchestration | Docker Compose |

## 🚀 Quick Start (Docker - Recommended)

The easiest way to run the entire stack (Frontend, Backend, AI Service, Postgres, and Redis) is using Docker Compose. Hot-reloading is enabled automatically for all services!

```bash
docker compose up --build
```
- **Client:** `http://localhost:5173`
- **Backend:** `http://localhost:5000`
- **AI Service:** `http://localhost:8000`

---

## 💻 Manual Setup (Without Docker)

### Prerequisites
- Node.js 18+
- Python 3.11+
- PostgreSQL 14+
- Redis 7+ (via WSL on Windows)

### 1. Initialize the database
Download from https://www.postgresql.org/download/ and install. Create a database:
```sql
CREATE DATABASE quizzit;
```
Then initialize the tables:
```bash
cd server
npm run db:init
```

### 2. Start the Node.js Backend
```bash
cd server
npm install
npm run dev
```

### 3. Start the React Frontend
```bash
cd client
npm install
npm run dev
```

### 4. Start the Python AI Service
```bash
cd server/ai
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

## ⚙️ Environment Variables (server/.env)

```env
PORT=5000
CLIENT_URL=http://localhost:5173

# PostgreSQL
DATABASE_URL=postgresql://postgres:admin123@localhost:5432/quizzit

# Game State Store Toggle (false = in-memory, true = redis)
USE_REDIS_ROOM_STORE=false
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=quizzit-super-secret-key-change-in-production-2024
JWT_EXPIRES_IN=7d

# Email (leave SMTP_USER empty to use Ethereal test emails)
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=       
SMTP_PASS=
EMAIL_FROM=noreply@quizzit.com
```

## 🎮 Usage Flow

1. **Educator** registers → Clicks "✨ AI Generate" or builds quiz manually → Publishes → Hosts room.
2. **Students** register → Enter the 6-digit room code → Wait in lobby.
3. **Educator** clicks "Start Quiz" → Questions sync to all students.
4. **Students** answer within time limit → See instant feedback.
5. **Between questions** → Leaderboard shows top 10 + personal rank.
6. **After last question** → Final podium with top 3 + full results.
