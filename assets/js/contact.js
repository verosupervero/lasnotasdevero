import { validateRecipientKey, encryptContact } from "./contact-crypto.js";

const RECIPIENT_EMAIL = "lasnotasdevero@protonmail.com";
const MAX_KEY_BYTES = 128 * 1024;
const editor = document.getElementById("contact-editor");

if (editor) {
  const button = editor.querySelector("button");
  const status = document.getElementById("contact-status");
  const fields = {
    name: document.getElementById("contact-name"),
    email: document.getElementById("contact-email"),
    subject: document.getElementById("contact-subject"),
    message: document.getElementById("contact-message"),
  };
  const limits = { name: 120, email: 254, subject: 200, message: 10000 };
  let recipientKey;
  let sending = false;

  function showStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state;
  }

  function validate(name, field) {
    field.setCustomValidity(!field.value.trim()
      ? "Completá este campo."
      : field.value.length > limits[name]
        ? "El contenido supera el tamaño permitido."
        : "");
  }

  Object.entries(fields).forEach(([name, field]) => {
    field.addEventListener("input", () => validate(name, field));
  });

  button.addEventListener("click", async () => {
    if (sending || !recipientKey) return;
    for (const [name, field] of Object.entries(fields)) {
      validate(name, field);
      if (!field.reportValidity()) return;
    }

    sending = true;
    button.disabled = true;
    Object.values(fields).forEach((field) => { field.readOnly = true; });
    editor.setAttribute("aria-busy", "true");
    showStatus("Cifrando mensaje…", "pending");
    let timeout;

    try {
      if (document.getElementById("contact-bot-field").value !== "") {
        throw new Error("Spam check failed");
      }
      const values = {
        name: fields.name.value,
        email: fields.email.value,
        subject: fields.subject.value,
        message: fields.message.value,
      };
      const armored = await encryptContact({ values, key: recipientKey, recipientEmail: RECIPIENT_EMAIL });
      if (typeof armored !== "string" || !armored.startsWith("-----BEGIN PGP MESSAGE-----") || armored.length > 128 * 1024) {
        throw new Error("Encryption failed");
      }
      const body = new URLSearchParams({
        "form-name": "contacto-cifrado",
        "bot-field": "",
        encrypted_message: armored,
      });
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 20000);
      showStatus("Enviando mensaje cifrado…", "pending");
      const response = await fetch("/contacto/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (!response.ok || response.redirected || response.type === "opaque") {
        throw new Error("Submission was not accepted");
      }
      Object.values(fields).forEach((field) => {
        field.value = "";
        field.setCustomValidity("");
      });
      showStatus("Tu mensaje cifrado fue aceptado. Gracias por escribirme.", "success");
    } catch {
      showStatus("No se pudo confirmar el envío. Tus datos se conservaron; revisá tu conexión o volvé a intentarlo más tarde.", "error");
    } finally {
      clearTimeout(timeout);
      sending = false;
      button.disabled = !recipientKey;
      Object.values(fields).forEach((field) => { field.readOnly = false; });
      editor.removeAttribute("aria-busy");
      status.focus();
    }
  });

  async function readPublicKey(response) {
    if (!response.ok || response.redirected || !response.body || Number(response.headers.get("Content-Length")) > MAX_KEY_BYTES) {
      throw new Error("Public key unavailable");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let armoredKey = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_KEY_BYTES) throw new Error("Public key too large");
        armoredKey += decoder.decode(value, { stream: true });
      }
      return armoredKey + decoder.decode();
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }

  async function prepareEncryption() {
    if (editor.dataset.enabled !== "true") return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      if (!window.isSecureContext || location.protocol !== "https:" || !window.crypto?.subtle) {
        throw new Error("Secure context required");
      }
      const configuredPath = editor.dataset.keyUrl;
      if (!configuredPath || !configuredPath.startsWith("/") || configuredPath.startsWith("//")) {
        throw new Error("Invalid public key URL");
      }
      const keyURL = new URL(configuredPath, location.origin);
      if (keyURL.origin !== location.origin || keyURL.search || keyURL.hash || keyURL.username || keyURL.password) {
        throw new Error("Invalid public key URL");
      }
      showStatus("Preparando el cifrado…", "pending");
      const response = await fetch(keyURL, {
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-cache",
        signal: controller.signal,
      });
      const armoredKey = await readPublicKey(response);
      recipientKey = await validateRecipientKey({
        armoredKey,
        expectedFingerprint: editor.dataset.keyFingerprint,
        recipientEmail: RECIPIENT_EMAIL,
      });
      if (!recipientKey) throw new Error("Invalid public key");
      button.disabled = false;
      status.textContent = "";
      delete status.dataset.state;
    } catch {
      recipientKey = undefined;
      button.disabled = true;
      showStatus("No se pudo preparar el cifrado. No se enviaron datos. Volvé a intentarlo más tarde.", "error");
    } finally {
      clearTimeout(timeout);
    }
  }

  void prepareEncryption();
}
