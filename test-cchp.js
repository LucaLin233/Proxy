"use strict";
/* 离线验证 aiapi_relay.js 的 CCHP 余额分支：不联网、不读凭据、不写持久化文件。
   夹具值取自 2026-10-21 脱敏后的 CCHP 实际响应（5 个 provider，Kcne 的 account 覆盖 3 个 key）。 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert/strict");

const CODE = fs.readFileSync(path.join(__dirname, "surge/scripts/aiapi_relay.js"), "utf8");
const ENDPOINTS = "Clouder@https://cch.invalid=clouder-key:user|CCHP@https://cchp.invalid=cchp-token:cchp";
const ARGUMENT = "cch_endpoints=" + encodeURIComponent(ENDPOINTS) + "&cch_quota_interval=600"
  + "&aiapi_icon=dollarsign.circle&aiapi_icon_color=5B8DEF";

function fresh(daysAgo) {
  return new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();
}

function fixtureProviders() {
  return [
    { id: "p-clouder", name: "Clouder", website_url: "https://cc2.caaa.tech/zh-CN/dashboard",
      keys: [{ id: "k-clouder", name: "OpenAI-Clouder", priority: 1, status: "disabled" }],
      balance: { status: "ok", unlimited: false, totals: [{ unit: "USD", amount: 97.32378783 }],
        total_usd: 97.32378783, checked_at: fresh(2), oldest_checked_at: fresh(2) } },
    { id: "p-kcne", name: "Kcne", website_url: "https://api.kcne.top/dashboard",
      keys: [{ id: "k1", name: "Claude-Kcne", priority: 1, status: "active" },
        { id: "k2", name: "DeepSeek-Kcne", priority: 2, status: "active" },
        { id: "k3", name: "OpenAI-Kcne", priority: 4, status: "active" }],
      balance: { status: "ok", unlimited: false, totals: [{ unit: "USD", amount: 21.42088229 }],
        total_usd: 21.42088229, checked_at: fresh(0.1), oldest_checked_at: fresh(0.1) } },
    { id: "p-mi", name: "Mi", website_url: "https://cch.are.sb",
      keys: [{ id: "k4", name: "DeepSeek-Mi", priority: 1, status: "active" }],
      balance: { status: "ok", unlimited: false, totals: [{ unit: "USD", amount: 7834.19239996 }],
        total_usd: 7834.19239996, checked_at: fresh(0.1), oldest_checked_at: fresh(0.1) } },
    { id: "p-sd", name: "SD", website_url: "https://sourcesdata.com/dashboard",
      keys: [{ id: "k5", name: "OpenAI-SD", priority: 3, status: "active" },
        { id: "k6", name: "DeepSeek-SD", priority: 3, status: "active" }],
      balance: { status: "ok", unlimited: false, totals: [{ unit: "USD", amount: 27.01203248 }],
        total_usd: 27.01203248, checked_at: fresh(0.1), oldest_checked_at: fresh(0.1) } },
    { id: "p-air", name: "Air", website_url: "https://www.air-router.com/dashboard",
      keys: [{ id: "k7", name: "OpenAI-Air", priority: 2, status: "active" }],
      balance: { status: "ok", unlimited: false, totals: [{ unit: "USD", amount: 18.5501195 }],
        total_usd: 18.5501195, checked_at: fresh(0.1), oldest_checked_at: fresh(0.1) } },
  ];
}

function makeWorld() {
  const state = {
    orgId: "org-fixture",
    providers: fixtureProviders(),
    providersStatus: 200,
    keysStatus: 200,
    failKeysFor: new Set(),
    quota: { keyLimitTotalUsd: 120, keyCurrentTotalUsd: 22.68 },
    inflight: 0,
    maxInflight: 0,
    calls: [],
  };

  function serve(method) {
    return (options, callback) => {
      const url = new URL(options.url);
      state.calls.push({ method, host: url.host, path: url.pathname });
      const send = (status, body) => callback(null, { status, headers: {} }, JSON.stringify(body));

      if (url.pathname === "/api/account/org-tree") return send(200, { root: { id: state.orgId } });
      if (/^\/api\/account\/orgs\/[^/]+\/providers$/.test(url.pathname)) {
        if (state.providersStatus !== 200) return send(state.providersStatus, { error: "fixture failure" });
        return send(200, { providers: state.providers, total: state.providers.length });
      }
      const keys = /^\/api\/account\/orgs\/([^/]+)\/providers\/([^/]+)\/keys$/.exec(url.pathname);
      if (keys) {
        const id = decodeURIComponent(keys[2]);
        state.inflight += 1;
        state.maxInflight = Math.max(state.maxInflight, state.inflight);
        setTimeout(() => {
          state.inflight -= 1;
          if (state.keysStatus !== 200 || state.failKeysFor.has(id)) return send(500, { error: "fixture failure" });
          const provider = state.providers.find((item) => item.id === id);
          return send(200, { keys: provider ? provider.keys : [] });
        }, 0);
        return;
      }
      if (url.pathname === "/api/v1/me/quota") return send(200, state.quota);
      return send(404, { error: "unexpected " + url.pathname });
    };
  }

  state.http = { get: serve("get"), post: serve("post") };
  return state;
}

async function run(world, options) {
  const settings = options || {};
  world.calls.length = 0;
  world.inflight = 0;
  world.maxInflight = 0;
  const store = settings.store || new Map();
  const notifications = [];
  let resolveDone;
  const finished = new Promise((resolve) => { resolveDone = resolve; });
  const argument = settings.argument || ARGUMENT;

  const context = vm.createContext({
    $argument: argument,
    $httpClient: world.http,
    $persistentStore: {
      read: (key) => (store.has(key) ? store.get(key) : null),
      write: (value, key) => { store.set(key, value); return true; },
    },
    $notification: { post: (...args) => notifications.push(args) },
    $done: resolveDone,
  });
  vm.runInContext(CODE, context, { timeout: 5000 });
  const result = await finished;
  const isDaily = /mode=daily/.test(argument);
  return {
    context,
    store,
    result,
    notifications,
    calls: world.calls.slice(),
    maxInflight: world.maxInflight,
    text: isDaily ? (notifications[0] || [])[2] : result && result.content,
  };
}

function labels(text) {
  return String(text).split("\n")
    .filter((line) => line && !line.startsWith("更新 ") && !line.startsWith("⚠️") && !line.startsWith("未获取到"))
    .map((line) => line.split(" · ")[0]);
}

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log("PASS " + name);
  } catch (error) {
    fail += 1;
    console.log("FAIL " + name + ": " + ((error && error.message) || error));
  }
}

(async () => {
  await check("CCHP 5 个 provider → 4 条余额行，Clouder 由 CCH 站点提供且排序在 1", async () => {
    const world = makeWorld();
    const r = await run(world, { store: new Map() });
    assert.deepEqual(labels(r.text), ["Kcne", "Clouder", "Mi", "Air", "SD"]);
    assert.equal((r.text.match(/Clouder/g) || []).length, 1);
    assert.match(r.text, /Kcne · 余额 \$21\.42/);
    assert.match(r.text, /Clouder · 余额 \$97\.32/);
    assert.match(r.text, /Mi · 余额 \$7834\.19/);
    assert.match(r.text, /Air · 余额 \$18\.55/);
    assert.match(r.text, /SD · 余额 \$27\.01/);
    assert.ok(r.calls.some((c) => c.path === "/api/account/org-tree"));
    assert.equal(r.calls.filter((c) => /\/keys$/.test(c.path)).length, 5);
    assert.ok(!r.calls.some((c) => c.path.includes("usage/summary")));
    assert.ok(!r.calls.some((c) => c.path === "/api/v1/dashboard/overview"));
    assert.ok(!r.text.includes("今日"));
    assert.ok(!r.text.includes("限额"));
    assert.match(r.text, /更新 \d{2}:\d{2}/);
    assert.equal(r.result["icon-color"], "#5B8DEF");
    assert.ok(!r.text.includes("部分余额较旧"), "Clouder 的旧余额不应产生提示（该行由 CCH 提供）");
  });

  await check("CCHP 元数据喂给 cchSitePriorities：Clouder 按名称与域名取到 1", async () => {
    const world = makeWorld();
    const r = await run(world, { store: new Map() });
    const priorities = r.context.cchSitePriorities([{
      site: { name: "Clouder", base: "https://cch.invalid" },
      data: { kind: "cchp", providers: [
        { name: "Clouder", host: "https://cc2.caaa.tech/zh-CN/dashboard", priority: 1, balance: {} },
        { name: "Kcne-Astra", host: "https://api.kcne.top/dashboard", priority: 2, balance: {} },
      ] },
    }]);
    assert.equal(priorities.byName.get("clouder"), 1);
    assert.equal(priorities.byDomain.get("cc2.caaa.tech"), 1);
    assert.equal(priorities.byName.get("kcne"), 2);
    assert.equal(r.context.cchpKeyPriority([{ priority: 4, status: "active" }, { priority: 2, status: "disabled" }]), 4);
    assert.equal(r.context.cchpKeyPriority([{ priority: 1, status: "disabled" }]), 1);
    assert.equal(r.context.cchpKeyPriority([]), null);
  });

  await check("unlimited 行显示「余额 不限量」", async () => {
    const world = makeWorld();
    world.providers = world.providers.map((p) => (p.name === "SD"
      ? { ...p, balance: { status: "ok", unlimited: true, totals: [], total_usd: null, checked_at: fresh(0.1), oldest_checked_at: fresh(0.1) } }
      : p));
    const r = await run(world, { store: new Map() });
    assert.match(r.text, /SD · 余额 不限量/);
    assert.equal(labels(r.text).pop(), "SD");
  });

  await check("status!==ok 不占行，面板转警告色", async () => {
    const world = makeWorld();
    world.providers = world.providers.map((p) => (p.name === "Mi"
      ? { ...p, balance: { ...p.balance, status: "error" } }
      : p));
    const r = await run(world, { store: new Map() });
    assert.deepEqual(labels(r.text), ["Kcne", "Clouder", "Air", "SD"]);
    assert.ok(!r.text.includes("Mi ·"));
    assert.equal(r.result["icon-color"], "#F59E0B");
  });

  await check("缓存命中不重复请求，结果一致", async () => {
    const world = makeWorld();
    const store = new Map();
    const first = await run(world, { store });
    assert.ok(first.calls.length >= 7, "首次应请求 org-tree/providers/keys");
    const second = await run(world, { store });
    const cchpCalls = second.calls.filter((call) => call.host === "cchp.invalid");
    assert.equal(cchpCalls.length, 0, "CCHP 缓存命中后不应再请求: " + JSON.stringify(cchpCalls));
    assert.equal(second.text.replace(/更新 \d{2}:\d{2}/, "更新"), first.text.replace(/更新 \d{2}:\d{2}/, "更新"));
    assert.ok(!second.text.includes("来自缓存"));
  });

  await check("请求失败但有旧缓存：显示旧值并提示来自缓存", async () => {
    const world = makeWorld();
    const store = new Map();
    const first = await run(world, { store });
    for (const [key, value] of store) {
      if (!key.startsWith("cchp_balance_")) continue;
      const cache = JSON.parse(value);
      cache.updatedAt = Date.now() - 3600 * 1000;
      store.set(key, JSON.stringify(cache));
    }
    world.providersStatus = 500;
    const stale = await run(world, { store });
    assert.match(stale.text, /⚠️ CCHP 余额来自缓存/);
    assert.match(stale.text, /Kcne · 余额 \$21\.42/);
    assert.equal(stale.text.split("\n").filter((l) => / · 余额 /.test(l)).length,
      first.text.split("\n").filter((l) => / · 余额 /.test(l)).length);
    assert.equal(stale.result["icon-color"], "#F59E0B");
  });

  await check("无旧缓存时该站失败只影响自身，不输出 0", async () => {
    const world = makeWorld();
    world.providersStatus = 500;
    const r = await run(world, { store: new Map() });
    assert.deepEqual(labels(r.text), ["Clouder"]);
    assert.ok(!/Kcne|Mi|Air|SD/.test(r.text));
    assert.ok(!r.text.includes("$0.00"));
    assert.equal(r.result["icon-color"], "#F59E0B");
  });

  await check("oldest_checked_at 超过 24 小时提示「部分余额较旧」", async () => {
    const world = makeWorld();
    world.providers = world.providers.map((p) => (p.name === "Kcne"
      ? { ...p, balance: { ...p.balance, oldest_checked_at: fresh(2) } }
      : p));
    const r = await run(world, { store: new Map() });
    assert.match(r.text, /⚠️ 部分余额较旧/);
  });

  await check("单把 key 请求失败只丢 priority，余额行仍在并排到最后", async () => {
    const world = makeWorld();
    world.failKeysFor.add("p-mi");
    const r = await run(world, { store: new Map() });
    assert.deepEqual(labels(r.text), ["Kcne", "Clouder", "Air", "SD", "Mi"]);
    assert.match(r.text, /Mi · 余额 \$7834\.19/);
  });

  await check("keys 请求最多 5 个在途且确实并发", async () => {
    const world = makeWorld();
    const r = await run(world, { store: new Map() });
    assert.ok(r.maxInflight >= 2, "应并发请求，实际 " + r.maxInflight);
    assert.ok(r.maxInflight <= 5, "并发上限应为 5，实际 " + r.maxInflight);
  });

  await check("日报标题改为【余额】，正文与面板同源", async () => {
    const world = makeWorld();
    const r = await run(world, { store: new Map(), argument: ARGUMENT + "&mode=daily" });
    assert.equal(r.notifications.length, 1);
    const body = r.notifications[0][2];
    assert.ok(body.startsWith("【余额】\n"), "日报应以【余额】开头: " + body.split("\n")[0]);
    assert.match(body, /Kcne · 余额 \$21\.42/);
    assert.match(body, /Clouder · 余额 \$97\.32/);
    assert.ok(!body.includes("今日"));
  });

  console.log("\n" + pass + " passed, " + fail + " failed");
  if (fail) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
