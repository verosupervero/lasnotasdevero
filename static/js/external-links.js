(() => {
  const script = document.currentScript;
  const normalizeHost = (hostname) => hostname.toLowerCase().replace(/^www\./, "");
  const internalHosts = new Set([
    normalizeHost(window.location.hostname),
    normalizeHost(new URL(script.dataset.siteUrl).hostname),
  ]);

  document.querySelectorAll("a[href]").forEach((link) => {
    let url;
    try {
      url = new URL(link.getAttribute("href"), document.baseURI);
    } catch {
      return;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") return;

    if (internalHosts.has(normalizeHost(url.hostname))) {
      link.removeAttribute("target");
    } else {
      link.target = "_blank";
      link.relList.add("noopener", "noreferrer");
    }
  });
})();
