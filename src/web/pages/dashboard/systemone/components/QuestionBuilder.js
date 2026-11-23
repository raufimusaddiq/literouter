"use client";

import { useState } from "react";
import { Badge, Button, Select } from "@/shared/components";
import { fieldClass, iconButtonClass, linkButtonClass } from "./fieldClass";
import {
  MAX_SCORE_LEVELS,
  QUESTION_TYPES,
  blankQuestion,
  makeId,
  questionTypeLabel,
  visibleKeyError,
} from "../lib/requestBuilder";

function IconButton({ label, icon, onClick, disabled }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={iconButtonClass}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{icon}</span>
    </button>
  );
}

export default function QuestionBuilder({ form, onChange, errors = {}, emptyActions = null }) {
  const [pendingType, setPendingType] = useState("noul");
  const [touched, setTouched] = useState(() => new Set());
  const markTouched = (id) => setTouched((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  const questions = form.questions;

  const update = (id, values) => {
    onChange({ ...form, questions: questions.map((entry) => (entry.id === id ? { ...entry, ...values } : entry)) });
  };

  const changeType = (id, type) => {
    const question = questions.find((entry) => entry.id === id);
    const next = blankQuestion(type);
    update(id, {
      type,
      yes: type === "noul" ? question.yes : "",
      no: type === "noul" ? question.no : "",
      options: type === "choice" ? (question.options.length ? question.options : next.options) : [],
      levels: type === "score" ? (question.levels.length ? question.levels : next.levels) : [],
    });
  };

  const add = () => onChange({ ...form, questions: [...questions, blankQuestion(pendingType)] });
  const remove = (id) => onChange({ ...form, questions: questions.filter((entry) => entry.id !== id) });
  const duplicate = (id) => {
    const source = questions.find((entry) => entry.id === id);
    const copy = {
      ...source,
      id: makeId(),
      key: "",
      options: source.options.map((option) => ({ ...option, id: makeId() })),
      levels: [...source.levels],
    };
    const index = questions.indexOf(source);
    onChange({ ...form, questions: [...questions.slice(0, index + 1), copy, ...questions.slice(index + 1)] });
  };

  const move = (id, direction) => {
    const index = questions.findIndex((entry) => entry.id === id);
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...form, questions: next });
  };

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted">No questions yet.</p>
        <Button type="button" size="sm" icon="add" onClick={add}>Add question</Button>
        {emptyActions && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">or start from:</span>
            {emptyActions}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0 flex-1 sm:max-w-[240px]">
          <Select
            label="Add question"
            value={pendingType}
            onChange={(event) => setPendingType(event.target.value)}
            options={QUESTION_TYPES.map((entry) => ({ value: entry.value, label: `${entry.label} — ${entry.description}` }))}
            selectClassName="text-xs"
          />
        </div>
        <Button type="button" size="sm" variant="secondary" icon="add" onClick={add}>Add question</Button>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {questions.map((question, index) => {
          const keyError = visibleKeyError(question, questions, touched);
          const fieldError = errors[question.key.trim()] || keyError;
          return (
            <fieldset
              key={question.id}
              aria-labelledby={`question-${question.id}-title`}
              className={`min-w-0 rounded-lg border bg-raise p-3 sm:p-4 ${fieldError ? "border-danger" : "border-line-strong"}`}
            >
              <legend className="sr-only">Question {index + 1}</legend>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span id={`question-${question.id}-title`} className="text-sm font-semibold text-ink">Question {index + 1}</span>
                  <Badge size="sm" variant="primary">{questionTypeLabel(question.type)}</Badge>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton label={`Move question ${index + 1} up`} icon="arrow_upward" onClick={() => move(question.id, -1)} disabled={index === 0} />
                  <IconButton label={`Move question ${index + 1} down`} icon="arrow_downward" onClick={() => move(question.id, 1)} disabled={index === questions.length - 1} />
                  <IconButton label={`Duplicate question ${index + 1}`} icon="content_copy" onClick={() => duplicate(question.id)} />
                  <IconButton label={`Delete question ${index + 1}`} icon="delete" onClick={() => remove(question.id)} />
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`key-${question.id}`} className="text-xs font-medium text-ink">Answer key</label>
                  <input
                    id={`key-${question.id}`}
                    value={question.key}
                    onChange={(event) => { markTouched(question.id); update(question.id, { key: event.target.value }); }}
                    onBlur={() => markTouched(question.id)}
                    placeholder="refund_requested"
                    spellCheck="false"
                    aria-invalid={fieldError ? "true" : undefined}
                    aria-describedby={fieldError ? `key-${question.id}-error` : undefined}
                    className={fieldClass({ invalid: Boolean(fieldError), panel: true, className: "mt-1 px-2.5 py-2 font-mono text-xs" })}
                  />
                  {fieldError && <p id={`key-${question.id}-error`} role="alert" className="mt-1 text-xs text-danger">{fieldError}</p>}
                </div>
                <div className="min-w-0">
                  <label htmlFor={`type-${question.id}`} className="text-xs font-medium text-ink">Type</label>
                  <select
                    id={`type-${question.id}`}
                    value={question.type}
                    onChange={(event) => changeType(question.id, event.target.value)}
                    className={fieldClass({ panel: true, className: "mt-1 appearance-none px-2.5 py-2 text-sm" })}
                  >
                    {QUESTION_TYPES.map((entry) => (
                      <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-3">
                <label htmlFor={`instructions-${question.id}`} className="text-xs font-medium text-ink">Instructions (optional)</label>
                <textarea
                  id={`instructions-${question.id}`}
                  value={question.instructions}
                  onChange={(event) => update(question.id, { instructions: event.target.value })}
                  placeholder={question.type === "noul" ? "Does the customer request a refund?" : "What should the answer describe?"}
                  className={fieldClass({ panel: true, className: "mt-1 min-h-[60px] resize-y p-2.5 text-sm" })}
                />
              </div>

              {question.type === "noul" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`yes-${question.id}`} className="text-xs font-medium text-ink">Counts as yes</label>
                    <input
                      id={`yes-${question.id}`}
                      value={question.yes}
                      onChange={(event) => update(question.id, { yes: event.target.value })}
                      placeholder="Optional"
                      className={fieldClass({ panel: true, className: "mt-1 px-2.5 py-2 text-sm" })}
                    />
                  </div>
                  <div>
                    <label htmlFor={`no-${question.id}`} className="text-xs font-medium text-ink">Counts as no</label>
                    <input
                      id={`no-${question.id}`}
                      value={question.no}
                      onChange={(event) => update(question.id, { no: event.target.value })}
                      placeholder="Optional"
                      className={fieldClass({ panel: true, className: "mt-1 px-2.5 py-2 text-sm" })}
                    />
                  </div>
                </div>
              )}

              {question.type === "choice" && (
                <div className="mt-3 flex flex-col gap-2">
                  {question.options.map((option, optionIndex) => (
                    <div key={option.id} className="flex flex-col gap-2 sm:flex-row sm:items-start">
                      <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                        <div className="sm:w-2/5">
                          <label htmlFor={`option-${option.id}`} className="sr-only">Option {optionIndex + 1} name</label>
                          <input
                            id={`option-${option.id}`}
                            value={option.name}
                            onChange={(event) => update(question.id, {
                              options: question.options.map((entry) => (entry.id === option.id ? { ...entry, name: event.target.value } : entry)),
                            })}
                            placeholder="Option name"
                            className={fieldClass({ panel: true, className: "px-2.5 py-2 text-sm" })}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <label htmlFor={`option-desc-${option.id}`} className="sr-only">Option {optionIndex + 1} description</label>
                          <input
                            id={`option-desc-${option.id}`}
                            value={option.description}
                            maxLength={255}
                            onChange={(event) => update(question.id, {
                              options: question.options.map((entry) => (entry.id === option.id ? { ...entry, description: event.target.value } : entry)),
                            })}
                            placeholder="Short description"
                            className={fieldClass({ panel: true, className: "px-2.5 py-2 text-sm" })}
                          />
                        </div>
                      </div>
                      <IconButton
                        label={`Remove option ${optionIndex + 1} from question ${index + 1}`}
                        icon="remove"
                        onClick={() => update(question.id, { options: question.options.filter((entry) => entry.id !== option.id) })}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => update(question.id, { options: [...question.options, { id: makeId(), name: "", description: "" }] })}
                    className={linkButtonClass}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add</span>
                    Add option
                  </button>
                </div>
              )}

              {question.type === "score" && (
                <div className="mt-3 flex flex-col gap-2">
                  {question.levels.map((level, levelIndex) => (
                    <div key={`${question.id}-level-${levelIndex}`} className="flex items-center gap-2">
                      <span className="w-6 shrink-0 text-center font-mono text-xs tabular-nums text-muted">{levelIndex}</span>
                      <label htmlFor={`level-${question.id}-${levelIndex}`} className="sr-only">Score level {levelIndex}</label>
                      <input
                        id={`level-${question.id}-${levelIndex}`}
                        value={level}
                        onChange={(event) => update(question.id, {
                          levels: question.levels.map((entry, i) => (i === levelIndex ? event.target.value : entry)),
                        })}
                        placeholder={`Level ${levelIndex} description`}
                        className={fieldClass({ panel: true, fill: false, className: "min-w-0 flex-1 px-2.5 py-2 text-sm" })}
                      />
                      <span className="flex shrink-0 items-center">
                        <IconButton
                          label={`Move score level ${levelIndex} up`}
                          icon="arrow_upward"
                          disabled={levelIndex === 0}
                          onClick={() => {
                            const next = [...question.levels];
                            [next[levelIndex - 1], next[levelIndex]] = [next[levelIndex], next[levelIndex - 1]];
                            update(question.id, { levels: next });
                          }}
                        />
                        <IconButton
                          label={`Move score level ${levelIndex} down`}
                          icon="arrow_downward"
                          disabled={levelIndex === question.levels.length - 1}
                          onClick={() => {
                            const next = [...question.levels];
                            [next[levelIndex + 1], next[levelIndex]] = [next[levelIndex], next[levelIndex + 1]];
                            update(question.id, { levels: next });
                          }}
                        />
                        <IconButton
                          label={`Remove score level ${levelIndex}`}
                          icon="remove"
                          disabled={question.levels.length <= 1}
                          onClick={() => update(question.id, { levels: question.levels.filter((entry, i) => i !== levelIndex) })}
                        />
                      </span>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={question.levels.length >= MAX_SCORE_LEVELS}
                    onClick={() => update(question.id, { levels: [...question.levels, ""] })}
                    className={linkButtonClass}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add</span>
                    Add level ({question.levels.length}/{MAX_SCORE_LEVELS})
                  </button>
                </div>
              )}

              {question.type === "box" && (
                <p className="mt-3 rounded-md border border-line bg-bg px-3 py-2 text-xs text-muted">
                  Box questions need an image. Upload one below and paste its placeholder into the state.
                </p>
              )}
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
