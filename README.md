# Quizzit — Live Quiz Platform

A real-time quiz platform where educators create and host live MCQ quizzes, and students join rooms to compete with live leaderboards.

## Features

- **Role-based auth** — Sign up as Educator or Student with email verification
- **Quiz builder** — Create MCQ quizzes with 2-4 options, set time limits, publish
- **Live rooms** — Host rooms with unique code + PIN, up to 400 students
- **Real-time gameplay** — Synchronized questions, timed answers, instant feedback
- **Scoring system** — Points for speed + correctness, streak bonuses
- **Live leaderboard** — Updates after each question
- **Podium results** — Top 3 celebration + full leaderboard at the end

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Real-time | Socket.IO |
| Auth | JWT + bcrypt |
| Email | Nodemailer |

## Prerequisites

- Node.js 18+
- PostgreSQL 14+

## Setup

### 1. Install PostgreSQL

Download from https://www.postgresql.org/download/ and install. Create a database:

```sql
CREATE DATABASE quizzit;
```

### 2. Initialize the database

```bash
cd server
cp .env.example .env  # or edit the existing .env with your DB credentials
npm run db:init
```

### 3. Start the backend

```bash
cd server
npm install
npm run dev
```

### 4. Start the frontend

```bash
cd client
npm install
npm run dev
```

### 5. Open the app

Visit `http://localhost:5173`

## Environment Variables (server/.env)

```
PORT=5000
CLIENT_URL=http://localhost:5173
DATABASE_URL=postgresql://postgres:password@localhost:5432/quizzit
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=       # leave empty for test emails
SMTP_PASS=
EMAIL_FROM=noreply@quizzit.com
```

## Usage Flow

1. **Educator** registers → Creates a quiz → Adds questions → Publishes → Hosts a live room
2. **Students** register → Enter room code + PIN → Wait in lobby
3. **Educator** clicks "Start Quiz" → Questions sync to all students
4. **Students** answer within time limit → See instant feedback
5. **Between questions** → Leaderboard shows top 10 + personal rank
6. **After last question** → Final podium with top 3 + full results
