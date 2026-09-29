import { WALLET_ICON_FALLBACKS } from '../auth/wallet-page-icons';
import { POPPIN_LOGO_DATA_URI } from '../auth/wallet-page-logo';

/**
 * THE PAGE A WALLET APPROVES A TRADE ON (trade/own-wallet.ts).
 *
 * The extension opens it in a small window with the trade's id and its one-off
 * key in the fragment. It finds the wallet the way the sign-in page does
 * (EIP-6963, window.ethereum as the fallback), checks that the wallet is on
 * the account's own address, moves it to Arc (adding Arc when the wallet does
 * not know it yet), and has it send exactly the transactions the server
 * built: an approval of this amount when one is needed, then the swap. The
 * server reads the swap from the chain before it counts it.
 *
 * The wallet used last is remembered in this page's own storage, so the next
 * trade starts in it without a list. Nothing else is stored.
 *
 * Inside this template literal a backslash must be written twice to reach the
 * page, so the script avoids them.
 */
export function confirmTradePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confirm in your wallet · Poppin</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #fff;
    background: radial-gradient(70% 50% at 50% 0%, rgba(104,198,255,.13), rgba(104,198,255,0) 70%), linear-gradient(180deg, #111E30 0%, #0B111C 55%, #090D15 100%);
    display: flex; justify-content: center; padding: 48px 20px 32px; }
  main { width: 100%; max-width: 400px; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .logo { width: 56px; height: 56px; border-radius: 50%; box-shadow: 0 8px 24px -8px rgba(104,198,255,.45); }
  h1 { margin: 20px 0 0; font-size: 26px; font-weight: 700; letter-spacing: -.02em; }
  p.sub { margin: 8px 0 0; font-size: 15px; line-height: 1.5; color: rgba(255,255,255,.62); }
  .list { width: 100%; margin-top: 24px; display: grid; gap: 10px; }
  .w { width: 100%; display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 0; border-radius: 16px; cursor: pointer;
    font: inherit; color: #EAF2FB; text-align: left; background: rgba(255,255,255,.04); box-shadow: inset 0 0 0 1px rgba(122,201,255,.16); }
  .w:hover { background: rgba(255,255,255,.07); }
  .w:disabled { opacity: .6; cursor: default; }
  .w img, .w .blank { width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0; }
  .w .blank { background: rgba(104,198,255,.14); display: grid; place-items: center; font-weight: 700; color: #CDEAFF; }
  .w b { flex: 1; font-size: 15px; font-weight: 600; }
  .w span.chev { color: #74849A; font-size: 20px; }
  .status { min-height: 22px; margin-top: 18px; font-size: 14px; line-height: 1.5; color: rgba(255,255,255,.72); }
  .status.err { color: #FF8A80; }
  .get { margin-top: 12px; font-size: 14px; color: rgba(255,255,255,.6); line-height: 1.7; }
  .get a { color: #9FD9FF; text-decoration: none; margin: 0 6px; }
  .done { margin-top: 24px; width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; color: #4ADE80;
    background: rgba(48,209,88,.12); box-shadow: inset 0 0 0 1px rgba(74,222,128,.3); font-size: 26px; }
  .hidden { display: none; }
</style>
</head>
<body>
<main>
  <img class="logo" src="${POPPIN_LOGO_DATA_URI}" alt="Poppin">
  <h1 id="title">Confirm in your wallet</h1>
  <p class="sub" id="sub">One moment.</p>
  <div class="list" id="list"></div>
  <div class="get hidden" id="get">Add a wallet to this browser to continue:<br>
    <a href="https://metamask.io/download" target="_blank" rel="noopener">MetaMask</a>
    <a href="https://rabby.io" target="_blank" rel="noopener">Rabby</a>
    <a href="https://phantom.com/download" target="_blank" rel="noopener">Phantom</a>
  </div>
  <div class="done hidden" id="done">&#10003;</div>
  <div class="status" id="status" role="status"></div>
</main>
<script>
(function () {
  var API = location.origin + "/api/v1/wallet/confirm";
  var parts = (location.hash || "").slice(1).split(".");
  var ID = parts[0] || "", KEY = parts[1] || "";
  var REMEMBER = "poppin.wallet.rdns";
  var found = new Map();
  var busy = false, data = null, settled = false, started = false;
  var list = document.getElementById("list");
  var status = document.getElementById("status");
  var FALLBACKS = ${JSON.stringify(WALLET_ICON_FALLBACKS)};

  function say(text, err) { status.textContent = text || ""; status.className = err ? "status err" : "status"; }
  function lower(s) { return String(s || "").toLowerCase(); }
  function short(a) { return a.slice(0, 6) + "…" + a.slice(-4); }
  function remembered() { try { return localStorage.getItem(REMEMBER) || ""; } catch (e) { return ""; } }
  function remember(rdns) { try { localStorage.setItem(REMEMBER, rdns || ""); } catch (e) {} }

  function post(path, body) {
    return fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.message ? j.message : "Something went wrong. Try again."); return j; }); });
  }

  function iconSrc(src) {
    if (typeof src !== "string") return "";
    var s = src.trim();
    if (s.indexOf("https://") === 0) return s;
    if (s.indexOf("data:image/") !== 0) return "";
    var head = "data:image/svg+xml";
    if (s.indexOf(head) === 0 && s.indexOf(";base64,") < 0) {
      var body = s.slice(s.indexOf(",") + 1);
      try { body = decodeURIComponent(body); } catch (e) {}
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(body);
    }
    return s;
  }
  function letterDisc(name) {
    var span = document.createElement("span");
    span.className = "blank";
    span.textContent = (name || "W").trim().charAt(0).toUpperCase();
    return span;
  }

  function render(final) {
    list.innerHTML = "";
    if (settled) return;
    found.forEach(function (d) {
      var b = document.createElement("button");
      b.className = "w"; b.type = "button"; b.disabled = busy;
      var label = (d.info && d.info.name) || "Browser wallet";
      var fallback = FALLBACKS[(d.info && d.info.rdns) || ""] || "";
      var icon = iconSrc(d.info && d.info.icon) || fallback;
      var img;
      if (icon) {
        img = document.createElement("img"); img.alt = "";
        img.addEventListener("error", function () {
          if (fallback && img.src !== fallback) { img.src = fallback; return; }
          if (img.parentNode) img.parentNode.replaceChild(letterDisc(label), img);
        });
        img.src = icon;
      } else {
        img = letterDisc(label);
      }
      var name = document.createElement("b"); name.textContent = label;
      var chev = document.createElement("span"); chev.className = "chev"; chev.textContent = "›";
      b.appendChild(img); b.appendChild(name); b.appendChild(chev);
      b.addEventListener("click", function () { run(d); });
      list.appendChild(b);
    });
    document.getElementById("get").className = found.size === 0 && final ? "get" : "get hidden";
  }

  function discover() {
    window.addEventListener("eip6963:announceProvider", function (e) {
      var d = e.detail;
      if (!d || !d.info || !d.info.uuid || !d.provider) return;
      found.set(d.info.uuid, d);
      render(false);
    });
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(function () {
      if (found.size === 0 && window.ethereum) {
        found.set("injected", { info: { uuid: "injected", name: "Browser wallet", icon: "", rdns: "" }, provider: window.ethereum });
      }
      render(true);
      if (started || busy) return;
      // The wallet used last time, or the only one there is, starts on its own.
      var last = remembered(), pick = null;
      found.forEach(function (d) { if (last && d.info && d.info.rdns === last) pick = d; });
      if (!pick && found.size === 1) found.forEach(function (d) { pick = d; });
      if (pick) run(pick);
      else if (found.size > 0) say("Choose the wallet you signed in with.");
    }, 700);
  }

  function switchChain(p) {
    return p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: data.chain.chainId }] })
      .catch(function (e) {
        var code = e && (e.code || (e.data && e.data.originalError && e.data.originalError.code));
        if (code === 4001) throw e;
        // 4902: the wallet does not know Arc yet. Adding it also switches to it.
        return p.request({ method: "wallet_addEthereumChain", params: [data.chain] });
      });
  }

  function waitReceipt(p, hash) {
    var t0 = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        p.request({ method: "eth_getTransactionReceipt", params: [hash] }).then(function (r) {
          if (r && r.status) {
            if (r.status === "0x1") resolve(); else reject(new Error("The approval did not go through. Try again."));
            return;
          }
          if (Date.now() - t0 > 90000) { reject(new Error("Arc is slow to answer. Try again in a moment.")); return; }
          setTimeout(poll, 800);
        }, function () { setTimeout(poll, 1200); });
      })();
    });
  }

  function sendAll(p, name) {
    var hashes = {};
    var two = data.txs.length > 1;
    var step = Promise.resolve();
    data.txs.forEach(function (tx) {
      step = step.then(function () {
        if (tx.kind === "approve") say(two ? "Step 1 of 2: allow this trade in " + name + "." : "Allow this trade in " + name + ".");
        else say(two ? "Step 2 of 2: confirm the trade in " + name + "." : "Confirm the trade in " + name + ".");
        return p.request({ method: "eth_sendTransaction", params: [{ from: data.address, to: tx.to, data: tx.data, value: tx.value }] });
      }).then(function (hash) {
        hashes[tx.kind] = hash;
        if (tx.kind === "approve") { say("Waiting for Arc."); return waitReceipt(p, hash); }
      });
    });
    return step.then(function () { return hashes; });
  }

  function finish(r) {
    if (r.state === "done" || r.state === "sending") {
      settled = true;
      document.getElementById("title").textContent = r.state === "done" ? "Done." : "Sent.";
      document.getElementById("sub").textContent = r.state === "done" ? "Back to Poppin. You can close this window." : (r.error || "It is still settling. You can close this window.");
      list.innerHTML = ""; document.getElementById("done").className = "done";
      say("");
      window.postMessage({ type: "POPPIN_ARC_TRADE_DONE", id: ID }, location.origin);
      return;
    }
    throw new Error(r.error || "That trade did not go through.");
  }

  function run(d) {
    if (busy || settled || !data) return;
    busy = true; started = true; render(true);
    var p = d.provider, name = (d.info && d.info.name) || "your wallet";
    remember(d.info && d.info.rdns);
    say("Open " + name + " to continue.");
    p.request({ method: "eth_requestAccounts" })
      .then(function (accounts) {
        var mine = (accounts || []).map(lower);
        if (mine.indexOf(lower(data.address)) < 0) {
          throw new Error("Switch " + name + " to " + short(data.address) + ", the wallet you signed in with, then try again.");
        }
        return p.request({ method: "eth_chainId" });
      })
      .then(function (cid) { if (lower(cid) !== lower(data.chain.chainId)) return switchChain(p); })
      .then(function () { return sendAll(p, name); })
      .then(function (h) {
        say("Confirming on Arc.");
        return post("/submit", { id: ID, t: KEY, approveHash: h.approve || null, swapHash: h.swap });
      })
      .then(finish)
      .catch(function (err) {
        var declined = err && (err.code === 4001 || /reject|denied|cancel/i.test(String(err.message || "")));
        say(declined ? "You declined in " + name + ". Pick a wallet to try again." : (err && err.message) || "Something went wrong. Try again.", true);
        busy = false; render(true);
      });
  }

  if (!ID || !KEY) { say("This link is not valid. Start the trade again from Poppin.", true); return; }
  post("/data", { id: ID, t: KEY })
    .then(function (d) {
      data = d;
      document.getElementById("title").textContent = d.summary.title;
      document.getElementById("sub").textContent = d.summary.detail;
      if (d.state === "done") { finish({ state: "done" }); return; }
      discover();
    })
    .catch(function (err) { say((err && err.message) || "Something went wrong. Try again.", true); });
})();
</script>
</body>
</html>`;
}
