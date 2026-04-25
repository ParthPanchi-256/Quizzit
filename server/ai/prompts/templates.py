"""
Prompt templates for the quiz generation agent.

All LLM prompts live here — single source of truth.
Templates use Python f-strings, no vendor-specific formatting.
"""

SYSTEM_PROMPT = """You are Quizzit AI, an expert quiz generator. You help educators create high-quality quiz questions from various sources.

Your personality:
- Professional but friendly
- Concise — no long-winded responses
- Ask focused, clear clarification questions
- Always explain your reasoning briefly

Rules:
- Generate questions that test understanding, not just memorization
- Vary difficulty levels within a quiz
- Ensure all options are plausible (no obviously wrong distractors)
- For fill-in-the-blank, include common alternative spellings as accepted answers
- For multiple choice, ensure exactly the right number of correct answers
- Never generate offensive or biased content"""

ANALYZE_PROMPT = """Analyze the following content and identify:
1. The main topics/subjects covered
2. The depth of coverage (surface-level, moderate, comprehensive)
3. How many meaningful quiz questions could be generated
4. Whether additional context (web search) would significantly improve quiz quality

Content:
{content}

Respond in this exact JSON format:
{{
  "topics": ["topic1", "topic2", ...],
  "depth": "surface" | "moderate" | "comprehensive",
  "estimated_questions": <number>,
  "needs_search": <true/false>,
  "search_reason": "<why search would help, or empty string>",
  "summary": "<2-3 sentence summary of the content>"
}}"""

CLARIFY_TOPICS_PROMPT = """Based on the content analysis, I found these topics:
{topics}

The content summary: {summary}

Generate a friendly message asking the user which topic(s) to focus on. List the topics clearly. Also mention they can say "all" to cover everything.

Keep it concise — 2-3 sentences max, then list the topics."""

CLARIFY_PREFS_PROMPT = """The user wants to generate a quiz on: {focus}

Ask them about their preferences in a single, concise message. Cover:
1. Number of questions (suggest a reasonable range based on content depth: {depth})
2. Question types they want (single choice, multiple choice, fill-in-the-blank, or mix)
3. Difficulty level (easy, medium, hard, or mixed)
4. Time per question (suggest 30s for easy, 45s for medium, 60s for hard)

Keep it brief and conversational. Use bullet points."""

SUGGEST_SEARCH_PROMPT = """The content provided is {depth}-level on the topic "{focus}".

{search_reason}

Generate a brief message asking the user if they'd like you to search the web for additional material to create better questions. Make it clear this is optional and the quiz can be generated with just the provided content.

Keep it to 2 sentences max."""

GENERATE_QUIZ_PROMPT = """Generate a quiz based on the following specifications:

**Source Content:**
{content}

{search_supplement}

**Quiz Specifications:**
- Topic focus: {focus}
- Number of questions: {num_questions}
- Question types: {question_types}
- Difficulty: {difficulty}
- Time per question: {time_per_question}s

**Rules:**
- Each question must be clear and unambiguous
- Single choice: exactly 4 options, exactly 1 correct
- Multiple choice: exactly 4 options, 2-3 correct
- Fill-in-the-blank: 1-3 accepted answers (include common variations)
- Distribute difficulty evenly across the requested level
- Questions should test understanding, not just recall
- No trick questions

Respond with ONLY valid JSON in this exact format:
{{
  "title": "<quiz title>",
  "description": "<1-2 sentence description>",
  "timePerQuestion": {time_per_question},
  "questions": [
    {{
      "questionText": "<question>",
      "questionType": "single" | "multiple" | "fill_blank",
      "points": <5-20 based on difficulty>,
      "timeLimit": <seconds or null>,
      "options": [
        {{"optionText": "<text>", "isCorrect": true/false}},
        ...
      ]
    }},
    ...
  ]
}}"""

VERIFY_QUIZ_PROMPT = """Review the following generated quiz for quality issues:

{quiz_json}

Check for:
1. Duplicate or very similar questions
2. Questions with obviously wrong or implausible distractors
3. Ambiguous wording
4. Incorrect answers marked as correct
5. Missing variety in difficulty
6. Any factual errors you can identify

Respond with ONLY valid JSON:
{{
  "is_valid": true/false,
  "issues": ["issue1", "issue2", ...],
  "suggestions": ["suggestion1", ...]
}}

If the quiz is good, set is_valid to true and leave issues empty."""

PARSE_USER_PREFS_PROMPT = """Extract quiz preferences from the user's message:

User said: "{message}"

Available topics: {topics}
Content depth: {depth}
Estimated max questions: {max_questions}

Extract and respond with ONLY valid JSON:
{{
  "focus": "<topic or 'all'>",
  "num_questions": <number, default 10>,
  "question_types": ["single", "multiple", "fill_blank"],
  "difficulty": "easy" | "medium" | "hard" | "mixed",
  "time_per_question": <seconds, default 30>,
  "wants_search": <true/false/null (null = not mentioned)>
}}

If the user didn't specify something, use sensible defaults."""
