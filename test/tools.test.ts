import assert from "node:assert/strict"
import { test } from "node:test"
import { executeTool } from "../src/tools/index.js"

test("executeTool returns error for unknown tool", async () => {
  const result = await executeTool("nonexistent_tool", {})
  assert(result.startsWith("Error"))
  assert(result.includes("unknown tool"))
})

test("executeTool returns error when required args missing", async () => {
  const result = await executeTool("web_fetch", {})
  assert(result.startsWith("Error"))
})

test("executeTool returns error for bad url", async () => {
  const result = await executeTool("web_fetch", { url: "not-a-valid-url" })
  assert(result.startsWith("Error"))
})

test("bash_spawn starts and bash_status reports completion", async () => {
  const spawnResult = await executeTool("bash_spawn", { command: "echo hello from test" })
  assert(spawnResult.startsWith("[process"), "should return process id")
  const pid = spawnResult.match(/\[process (p\d+) started\]/)?.[1]
  assert(pid, `should extract process id from: ${spawnResult}`)

  // give it a moment to finish
  await new Promise((r) => setTimeout(r, 200))

  const statusResult = await executeTool("bash_status", { id: pid })
  assert(statusResult.includes("hello from test"), "should include stdout")
  assert(statusResult.includes("exited"), "should be done")
})

test("bash_kill terminates a running process", async () => {
  const spawnResult = await executeTool("bash_spawn", { command: "sleep 30" })
  const pid = spawnResult.match(/\[process (p\d+) started\]/)?.[1]
  assert(pid, `should extract process id from: ${spawnResult}`)

  const killResult = await executeTool("bash_kill", { id: pid, signal: "SIGKILL" })
  assert(killResult.includes("SIGKILL sent"))
})

test("bash_status returns error for nonexistent pid", async () => {
  const result = await executeTool("bash_status", { id: "p99999" })
  assert(result.startsWith("Error"))
})
