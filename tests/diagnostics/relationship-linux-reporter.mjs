import { EvidenceStore } from "../../scripts/relationship-diagnostic-evidence.mjs";
// Diagnostic-only JSON receipt. No Vitest direct outputFile bypasses the budget.
export default class BoundedReporter {
  onTestRunEnd(modules) {
    const store = new EvidenceStore(
      process.env.RELATIONSHIP_DIAGNOSTIC_DIRECTORY,
      process.env.RELATIONSHIP_DIAGNOSTIC_STAGE,
      "reporter",
    );
    let count = 0;
    const collect = (task, ancestors = []) => {
      if (++count > 512) store.fail("reporter-task-count");
      if (task.tasks)
        return task.tasks.flatMap((child) =>
          collect(child, [...ancestors, task.name]),
        );
      return [
        {
          title: task.name,
          fullName: [...ancestors, task.name].join(" "),
          status:
            task.result?.state === "pass"
              ? "passed"
              : task.result?.state === "fail"
                ? "failed"
                : "skipped",
          duration: task.result?.duration,
          failureMessages: (task.result?.errors ?? []).map(
            (e) => e.stack ?? e.message,
          ),
        },
      ];
    };
    const testResults = modules.map((module) => ({
      name: module.task.filepath,
      assertionResults: collect(module.task),
      message: module.task.result?.errors?.[0]?.message ?? "",
    }));
    const assertions = testResults.flatMap((t) => t.assertionResults);
    store.save(`${store.stage}-vitest.json`, {
      format: "bounded-diagnostic-v1",
      numPassedTests: assertions.filter((t) => t.status === "passed").length,
      numFailedTests: assertions.filter((t) => t.status === "failed").length,
      testResults,
    });
  }
}
