/* 在每条推文的操作栏注入「保存到 XBoard」按钮，点击直接入队。 */
(() => {
  "use strict";

  const ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3h13A1.5 1.5 0 0 1 20 4.5v1.25c0 .69-.56 1.25-1.25 1.25H5.25C4.56 7 4 6.44 4 5.75V4.5Zm1.4 4.25h13.2l-1.2 11.1A1.75 1.75 0 0 1 15.66 21H8.34a1.75 1.75 0 0 1-1.74-1.15l-1.2-11.1ZM9.5 10.5a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5h-5Z"/></svg>';

  const RESET_DELAY = 2400;

  /** 从推文节点里读出规范化链接。 */
  function tweetUrl(article) {
    const anchors = article.querySelectorAll('a[href*="/status/"]');
    let fallback = "";
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href") || "";
      const match = href.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
      if (!match) continue;
      const url = `https://x.com/${match[1]}/status/${match[2]}`;
      if (anchor.querySelector("time")) return url;
      if (!fallback) fallback = url;
    }
    return fallback;
  }

  /** 操作栏是推文里最后一个 role=group 的容器。 */
  function actionBar(article) {
    const groups = article.querySelectorAll('div[role="group"]');
    return groups.length ? groups[groups.length - 1] : null;
  }

  function toast(message, kind) {
    let el = document.querySelector(".xb-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "xb-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.dataset.kind = kind || "";
    el.dataset.show = "true";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      el.dataset.show = "false";
    }, 3200);
  }

  function decorate(button) {
    button.dataset.state = button.dataset.state || "idle";
    button.setAttribute(
      "title",
      button.dataset.state === "idle" ? "保存到 XBoard" : button.title
    );
  }

  async function submit(article, button) {
    if (button.dataset.state === "loading") return;
    const url = tweetUrl(article);
    if (!url) {
      toast("没找到这条推文的链接", "error");
      return;
    }
    button.dataset.state = "loading";
    button.setAttribute("aria-busy", "true");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "submit-urls",
        urls: [url],
      });
      if (!response || !response.ok) {
        throw new Error((response && response.error) || "提交失败");
      }
      const queued = (response.result && response.result.queued) || 0;
      const rejected = (response.result && response.result.rejected) || [];
      if (!queued) {
        throw new Error(rejected.length ? "这条链接无法解析" : "没有排入任务");
      }
      button.dataset.state = "done";
      button.setAttribute("title", "已加入下载队列");
      toast("已加入下载队列", "ok");
    } catch (error) {
      button.dataset.state = "error";
      const message = (error && error.message) || "提交失败";
      button.setAttribute("title", message);
      toast(message, "error");
    } finally {
      button.removeAttribute("aria-busy");
      clearTimeout(button._xbTimer);
      button._xbTimer = setTimeout(() => {
        button.dataset.state = "idle";
        button.setAttribute("title", "保存到 XBoard");
      }, RESET_DELAY);
    }
  }

  function enhance(article) {
    if (article.dataset.xbEnhanced === "1" && article.querySelector(".xb-save")) {
      return;
    }
    const bar = actionBar(article);
    if (!bar) return;

    const existing = article.querySelector(".xb-save");
    if (existing) {
      article.dataset.xbEnhanced = "1";
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "xb-save";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "xb-save-btn";
    button.dataset.state = "idle";
    button.setAttribute("aria-label", "保存到 XBoard");
    button.setAttribute("title", "保存到 XBoard");
    button.innerHTML = ICON;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void submit(article, button);
    });
    // X 会给操作栏挂自己的事件，阻止冒泡避免触发原推文交互
    button.addEventListener("pointerdown", (event) => event.stopPropagation());

    wrap.appendChild(button);
    bar.appendChild(wrap);
    article.dataset.xbEnhanced = "1";
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope
      .querySelectorAll('article[data-testid="tweet"]')
      .forEach((article) => enhance(article));
  }

  let pending = null;
  const observer = new MutationObserver((records) => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      const touched = records.some((record) => {
        const node = record.target;
        return node && node.isConnected !== false;
      });
      if (touched) scan(document);
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => scan(document), { once: true });
  } else {
    scan(document);
  }

  // 路由切换（X 是 SPA）后重新扫描
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      scan(document);
    }
  }, 1200);
})();
