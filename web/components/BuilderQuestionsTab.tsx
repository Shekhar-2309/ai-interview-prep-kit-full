"use client";

import { useState } from "react";
import { api } from "../lib/api";
import { BuilderContext } from "./BuilderView";
import { OriginMark } from "./OriginMark";

const CATEGORIES = ["technical", "behavioural", "system-design", "company-fit"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};

export function BuilderQuestionsTab({ ctx }: { ctx: BuilderContext }) {
  const byCategory: Record<string, any[]> = {};
  for (const cat of CATEGORIES) byCategory[cat] = [];
  for (const q of ctx.kit.questions) {
    (byCategory[q.category] ??= []).push(q);
  }

  return (
    <div className="space-y-10">
      {CATEGORIES.filter((c) => byCategory[c].length > 0 || c === "technical" || c === "behavioural").map(
        (category) => (
          <CategorySection key={category} category={category} questions={byCategory[category]} ctx={ctx} />
        )
      )}
    </div>
  );
}

function CategorySection({
  category,
  questions,
  ctx,
}: {
  category: string;
  questions: any[];
  ctx: BuilderContext;
}) {
  const [adding, setAdding] = useState(false);

  async function regenerateCategory() {
    await ctx.mutate((kitId, version) =>
      api.regenerateSection(kitId, version, { section: "questions", category }) as any
    );
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const reordered = [...questions];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    await ctx.mutate((kitId, version) =>
            api.reorderQuestions(kitId, category, version, reordered.map((q) => q.id)) as any
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-mono text-sm text-ink">
          {CATEGORY_LABELS[category]} ({questions.length})
        </h3>
        <div className="flex gap-4">
          <button onClick={() => setAdding((v) => !v)} className="text-pen text-sm underline">
            Add question
          </button>
          <button
            onClick={regenerateCategory}
            disabled={ctx.busy}
            className="text-pen text-sm underline disabled:opacity-50"
          >
            Regenerate
          </button>
        </div>
      </div>

      {adding && <AddQuestionForm category={category} ctx={ctx} onDone={() => setAdding(false)} />}

      <div className="space-y-3">
        {questions.map((q, i) => (
          <QuestionCard
            key={q.id}
            question={q}
            ctx={ctx}
            onMoveUp={i > 0 ? () => move(i, -1) : undefined}
            onMoveDown={i < questions.length - 1 ? () => move(i, 1) : undefined}
          />
        ))}
        {questions.length === 0 && <p className="text-sm text-ink-faint">No questions in this category yet.</p>}
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  ctx,
  onMoveUp,
  onMoveDown,
}: {
  question: any;
  ctx: BuilderContext;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(question.prompt);
  const [answerOutline, setAnswerOutline] = useState(question.answer_outline);
  const [difficulty, setDifficulty] = useState(question.difficulty);

  async function save() {
    await ctx.mutate((kitId, version) =>
      api.editQuestion(kitId, question.id, version, {
        prompt,
        answer_outline: answerOutline,
        difficulty,
      }) as any
    );
    setEditing(false);
  }

  async function remove() {
    await ctx.mutate((kitId, version) => api.deleteQuestion(kitId, question.id, version) as any);
  }

  async function moveCategory(newCategory: string) {
    await ctx.mutate((kitId, version) => api.moveQuestion(kitId, question.id, version, newCategory) as any);
  }

  if (editing) {
    return (
      <div className="card-tab bg-surface border border-line p-4 space-y-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          className="w-full border border-line bg-white px-2 py-1.5 text-sm text-ink"
        />
        <textarea
          value={answerOutline}
          onChange={(e) => setAnswerOutline(e.target.value)}
          rows={3}
          className="w-full border border-line bg-white px-2 py-1.5 text-sm text-ink"
        />
        <div className="flex items-center gap-3">
          <label className="text-xs text-ink-faint">Difficulty</label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value))}
            className="border border-line bg-white text-sm px-2 py-1"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={ctx.busy}
            className="bg-ink text-surface font-mono text-xs px-3 py-1.5 hover:bg-ink/90 disabled:opacity-50"
          >
            Save
          </button>
          <button onClick={() => setEditing(false)} className="text-ink-faint text-xs px-3 py-1.5">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card-tab bg-surface border border-line p-4">
      <div className="flex items-start justify-between gap-4 mb-2">
        <p className="text-ink text-sm font-medium">{question.prompt}</p>
        <div className="flex items-center gap-2 shrink-0">
          <DifficultyDots value={question.difficulty} />
          <OriginMark meta={question._meta} />
        </div>
      </div>
      {question.answer_outline && (
        <p className="text-ink-faint text-sm leading-relaxed mb-3">{question.answer_outline}</p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button onClick={() => setEditing(true)} className="text-pen underline">
          Edit
        </button>
        <button onClick={remove} className="text-alert underline">
          Delete
        </button>
        <select
          value={question.category}
          onChange={(e) => moveCategory(e.target.value)}
          className="border border-line bg-white text-ink-faint px-1.5 py-1"
          aria-label="Move to category"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <div className="flex gap-1 ml-auto">
          {onMoveUp && (
            <button onClick={onMoveUp} aria-label="Move up" className="text-ink-faint hover:text-ink px-1">
              ↑
            </button>
          )}
          {onMoveDown && (
            <button onClick={onMoveDown} aria-label="Move down" className="text-ink-faint hover:text-ink px-1">
              ↓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AddQuestionForm({
  category,
  ctx,
  onDone,
}: {
  category: string;
  ctx: BuilderContext;
  onDone: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [answerOutline, setAnswerOutline] = useState("");
  const [difficulty, setDifficulty] = useState(2);

  async function submit() {
    if (!prompt.trim()) return;
    await ctx.mutate((kitId, version) =>
      api.addQuestion(kitId, version, {
        category,
        requirement_ids: [],
        prompt,
        answer_outline: answerOutline,
        difficulty,
      }) as any
    );
    onDone();
  }

  return (
    <div className="card-tab bg-surface border border-line border-dashed p-4 mb-3 space-y-2">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Question"
        rows={2}
        className="w-full border border-line bg-white px-2 py-1.5 text-sm text-ink"
      />
      <textarea
        value={answerOutline}
        onChange={(e) => setAnswerOutline(e.target.value)}
        placeholder="Answer outline (optional)"
        rows={2}
        className="w-full border border-line bg-white px-2 py-1.5 text-sm text-ink"
      />
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={ctx.busy}
          className="bg-ink text-surface font-mono text-xs px-3 py-1.5 hover:bg-ink/90 disabled:opacity-50"
        >
          Add
        </button>
        <button onClick={onDone} className="text-ink-faint text-xs px-3 py-1.5">
          Cancel
        </button>
      </div>
    </div>
  );
}

function DifficultyDots({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`difficulty ${value} of 3`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i <= value ? "bg-pen" : "bg-line"}`} />
      ))}
    </div>
  );
}
