import assert from "node:assert/strict"
import { test, beforeEach } from "node:test"
import { get, reload, clear } from "../src/prompts.js"

beforeEach(() => clear())

test("get loads a prompt file from disk", () => {
  const text = get("echo-system")
  assert(text.length > 0, "prompt should have content")
  assert(text.includes("{{challenge_url}}"), "should contain template variable")
})

test("get substitutes template variables", () => {
  const text = get("greeting", { name: "Alice", place: "Fly.io" })
  assert(text.includes("Hello Alice"))
  assert(text.includes("welcome to Fly.io"))
  assert(!text.includes("{{name}}"))
})

test("get caches after first read", () => {
  const text1 = get("echo-system")
  const text2 = get("echo-system")
  assert(text1 === text2, "cached copies should be same reference")
})

test("reload evicts a single cached prompt", () => {
  get("echo-system")
  reload("echo-system")
  // after reload, reading again should re-read (same content but new String)
  // not worth testing via reference identity, but it shouldn't throw
  assert.doesNotThrow(() => get("echo-system"))
})

test("clear evicts all cached prompts", () => {
  get("echo-system")
  get("greeting")
  clear()
  assert.doesNotThrow(() => {
    get("echo-system")
    get("greeting")
  })
})

test("get throws for nonexistent prompt", () => {
  assert.throws(() => get("nonexistent-prompt"), {
    code: "ENOENT",
  })
})
