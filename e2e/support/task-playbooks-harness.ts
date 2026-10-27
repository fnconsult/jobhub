import { taskInstructionsProblems, TASK_PLAYBOOKS } from "@jobhub/coach-knowledge/tasks";

// The Task Playbooks as the package exports them (#444): prints one `TP_RESULT <json>` line.
console.log(
  "TP_RESULT " +
    JSON.stringify(
      TASK_PLAYBOOKS.map((task) => ({ id: task.id, aiTask: task.aiTask, validatedAtImport: task.validatedAtImport, problems: taskInstructionsProblems(task, task.instructions) })),
    ),
);
