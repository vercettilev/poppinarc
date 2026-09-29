import { WALLET_ICON_FALLBACKS } from './wallet-page-icons';
import { POPPIN_LOGO_DATA_URI } from './wallet-page-logo';

/**
 * THE PAGE A WALLET SIGN-IN HAPPENS ON.
 *
 * It has to be a web page: a wallet puts its provider into http(s) pages, and
 * the extension's own pages are not among them. It is served by this service,
 * so the address a wallet shows in its signing window is this service's host,
 * the same one the message names.
 *
 * Wallets are found the way wallets ask to be found (EIP-6963: each one
 * announces its own name and icon), with the older single window.ethereum as
 * the fallback. The server writes the message; the page only asks the chosen
 * wallet to sign it, sends the signature back, and hands the session to the
 * extension with window.postMessage, which the extension's content-script
 * relay forwards. Nothing is stored in the page.
 */
export function walletSignInPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Continue with a wallet · Poppin</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #fff;
    background: radial-gradient(70% 50% at 50% 0%, rgba(104,198,255,.13), rgba(104,198,255,0) 70%), linear-gradient(180deg, #111E30 0%, #0B111C 55%, #090D15 100%);
    display: flex; justify-content: center; padding: 72px 20px 40px; }
  main { width: 100%; max-width: 420px; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .logo { width: 64px; height: 64px; border-radius: 50%; box-shadow: 0 8px 24px -8px rgba(104,198,255,.45); }
  h1 { margin: 24px 0 0; font-size: 32px; font-weight: 700; letter-spacing: -.02em; }
  p.sub { margin: 10px 0 0; font-size: 15px; line-height: 1.55; color: rgba(255,255,255,.6); }
  .list { width: 100%; margin-top: 28px; display: grid; gap: 10px; }
  .w { width: 100%; display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 0; border-radius: 16px; cursor: pointer;
    font: inherit; color: #EAF2FB; text-align: left; background: rgba(255,255,255,.04); box-shadow: inset 0 0 0 1px rgba(122,201,255,.16); }
  .w:hover { background: rgba(255,255,255,.07); }
  .w:disabled { opacity: .6; cursor: default; }
  .w img, .w .blank { width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0; }
  .w .blank { background: rgba(104,198,255,.14); display: grid; place-items: center; font-weight: 700; color: #CDEAFF; }
  .w b { flex: 1; font-size: 15px; font-weight: 600; }
  .w span.chev { color: #74849A; font-size: 20px; }
  .status { min-height: 22px; margin-top: 18px; font-size: 14px; color: rgba(255,255,255,.7); }
  .status.err { color: #FF8A80; }
  .get { margin-top: 12px; font-size: 14px; color: rgba(255,255,255,.6); line-height: 1.7; }
  .get a { color: #9FD9FF; text-decoration: none; margin: 0 6px; }
  .done { margin-top: 26px; width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; color: #4ADE80;
    background: rgba(48,209,88,.12); box-shadow: inset 0 0 0 1px rgba(74,222,128,.3); font-size: 26px; }
  .hidden { display: none; }
</style>
</head>
<body>
<main>
  <img class="logo" src="${POPPIN_LOGO_DATA_URI}" alt="Poppin">
  <h1 id="title">Continue with a wallet</h1>
  <p class="sub" id="sub">Choose your wallet, then sign a short message. It costs nothing and moves no money.</p>
  <div class="list" id="list"></div>
  <div class="get hidden" id="get">Add a wallet to this browser to continue:<br>
    <a href="https://metamask.io/download" target="_blank" rel="noopener">MetaMask</a>
    <a href="https://rabby.io" target="_blank" rel="noopener">Rabby</a>
    <a href="https://rainbow.me" target="_blank" rel="noopener">Rainbow</a>
  </div>
  <div class="done hidden" id="done">&#10003;</div>
  <div class="status" id="status" role="status"></div>
</main>
<script>
(function () {
  var API = location.origin + "/api/v1/auth/wallet";
  var found = new Map();
  var busy = false;
  var list = document.getElementById("list");
  var status = document.getElementById("status");

  function say(text, err) { status.textContent = text || ""; status.className = err ? "status err" : "status"; }
  var FALLBACKS = ${JSON.stringify(WALLET_ICON_FALLBACKS)};
  // A wallet's own icon: a data: image or an https address (wallets announce
  // both, whatever EIP-6963 prefers). An unencoded SVG is re-encoded so a "#"
  // inside it cannot cut the image short.
  function iconSrc(src) {
    if (typeof src !== "string") return "";
    var s = src.trim();
    if (/^https:\\/\\//i.test(s)) return s;
    if (!/^data:image\\//i.test(s)) return "";
    var m = /^data:image\\/svg\\+xml(;charset=[^,;]+)?,([\\s\\S]*)$/i.exec(s);
    if (m) {
      var body = m[2];
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
          // The announced icon did not load: the bundled mark, else the initial.
          if (fallback && img.src !== fallback) { img.src = fallback; return; }
          if (img.parentNode) img.parentNode.replaceChild(letterDisc(label), img);
        });
        img.src = icon;
      } else {
        img = letterDisc(label);
      }
      var name = document.createElement("b"); name.textContent = label;
      var chev = document.createElement("span"); chev.className = "chev"; chev.textContent = "\\u203A";
      b.appendChild(img); b.appendChild(name); b.appendChild(chev);
      b.addEventListener("click", function () { connect(d); });
      list.appendChild(b);
    });
    document.getElementById("get").className = found.size === 0 && final ? "get" : "get hidden";
  }

  window.addEventListener("eip6963:announceProvider", function (e) {
    var d = e.detail;
    if (!d || !d.info || !d.info.uuid || !d.provider) return;
    found.set(d.info.uuid, d);
    render(false);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  setTimeout(function () {
    if (found.size === 0 && window.ethereum) {
      found.set("injected", { info: { uuid: "injected", name: "Browser wallet", icon: "" }, provider: window.ethereum });
    }
    render(true);
  }, 700);

  function post(path, body) {
    return fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.message ? j.message : "Something went wrong. Try again."); return j; }); });
  }

  function hex(text) {
    var bytes = new TextEncoder().encode(text), out = "0x";
    for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out;
  }

  function connect(d) {
    if (busy) return;
    busy = true; render(true);
    var name = (d.info && d.info.name) || "your wallet";
    var p = d.provider, address;
    say("Open " + name + " to continue.");
    p.request({ method: "eth_requestAccounts" })
      .then(function (accounts) {
        address = accounts && accounts[0];
        if (!address) throw new Error("No account was shared. Pick a wallet to try again.");
        return p.request({ method: "eth_chainId" });
      })
      .then(function (chainHex) {
        return post("/challenge", { address: address, chainId: parseInt(chainHex, 16) });
      })
      .then(function (c) {
        say("Sign the message in " + name + ".");
        return p.request({ method: "personal_sign", params: [hex(c.message), address] }).then(function (sig) { return { c: c, sig: sig }; });
      })
      .then(function (x) { return post("/verify", { message: x.c.message, signature: x.sig }); })
      .then(function (r) {
        window.postMessage({ type: "POPPIN_ARC_WALLET_SIGNIN", token: r.token }, location.origin);
        document.getElementById("title").textContent = "You're in.";
        document.getElementById("sub").textContent = "Back to Poppin in a moment. You can close this tab.";
        list.innerHTML = ""; document.getElementById("done").className = "done";
        say("");
      })
      .catch(function (err) {
        var declined = err && (err.code === 4001 || /reject|denied|cancel/i.test(String(err.message || "")));
        say(declined ? "You declined in " + name + ". Pick a wallet to try again." : (err && err.message) || "Something went wrong. Try again.", true);
        busy = false; render(true);
      });
  }
})();
</script>
</body>
</html>`;
}
