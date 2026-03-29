function uniqueValues(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

const VALUE_OBJECT_KEYS = [
  "id",
  "lid",
  "jid",
  "pn",
  "phone_number",
  "phoneNumber",
  "participant",
  "participantAlt",
  "participantPn",
  "participantLid",
  "author",
  "authorPn",
  "authorLid",
  "sender",
  "senderAlt",
  "senderPn",
  "senderLid",
  "user",
  "chatId",
  "remoteJid",
  "remoteJidAlt",
  "phone",
  "number",
];

function extractValueCandidates(value = "") {
  const output = [];

  const push = (entry) => {
    if (entry === null || entry === undefined) {
      return;
    }

    if (Array.isArray(entry)) {
      for (const nested of entry) {
        push(nested);
      }
      return;
    }

    if (typeof entry === "object") {
      for (const key of VALUE_OBJECT_KEYS) {
        push(entry?.[key]);
      }
      return;
    }

    const raw = String(entry || "").trim();
    if (raw) {
      output.push(raw);
    }
  };

  push(value);
  return uniqueValues(output);
}

function getPrimaryValueCandidate(value = "") {
  const values = extractValueCandidates(value);

  return (
    values.find((entry) => entry.includes("@")) ||
    values.find((entry) => /^\+?\d+$/.test(entry)) ||
    values[0] ||
    ""
  );
}

export function normalizeJidUser(value = "") {
  const jid = getPrimaryValueCandidate(value);
  if (!jid) return "";
  const [user] = jid.split("@");
  return user.split(":")[0];
}

export function normalizeJidDigits(value = "") {
  for (const raw of extractValueCandidates(value)) {
    const normalized = normalizeJidUser(raw);
    const rawDigits = String(raw).replace(/[^\d]/g, "");
    const normalizedDigits = String(normalized).replace(/[^\d]/g, "");
    const looksPhoneLike =
      /^\+?\d+$/.test(raw) ||
      /^\d+@s\.whatsapp\.net$/i.test(raw) ||
      /^\d+@lid$/i.test(raw) ||
      /^\d+$/.test(normalized) ||
      /^\d{7,}$/.test(rawDigits);

    if (looksPhoneLike && rawDigits) {
      return rawDigits;
    }

    if (looksPhoneLike && normalizedDigits) {
      return normalizedDigits;
    }
  }

  const fallback = normalizeJidUser(value);
  return /^\d+$/.test(fallback) ? fallback : "";
}

function pushMatchKeys(target, value = "") {
  for (const raw of extractValueCandidates(value)) {
    target.add(raw.toLowerCase());

    const normalized = normalizeJidUser(raw);
    if (normalized) {
      target.add(normalized.toLowerCase());
    }

    const digits = normalizeJidDigits(raw);
    if (digits) {
      target.add(digits);
    }
  }
}

export function getMatchKeys(value = "") {
  const output = new Set();
  pushMatchKeys(output, value);
  return output;
}

export function getParticipantMatchKeys(participant = {}) {
  const output = new Set();

  for (const value of [
    participant,
    participant?.id,
    participant?.lid,
    participant?.jid,
    participant?.pn,
    participant?.phone_number,
    participant?.phoneNumber,
    participant?.participant,
    participant?.participantAlt,
    participant?.participantPn,
    participant?.participantLid,
  ]) {
    pushMatchKeys(output, value);
  }

  return output;
}

export function isParticipantAdmin(participant = {}) {
  return Boolean(participant?.admin);
}

export function isParticipantSuperAdmin(participant = {}) {
  return String(participant?.admin || "").trim().toLowerCase() === "superadmin";
}

export function findGroupParticipant(metadata = {}, values = []) {
  const candidates = Array.isArray(values) ? values : [values];
  const wanted = new Set();

  for (const value of candidates) {
    for (const key of getMatchKeys(value)) {
      wanted.add(key);
    }
  }

  if (!wanted.size) {
    return null;
  }

  const participants = Array.isArray(metadata?.participants)
    ? metadata.participants
    : [];

  for (const participant of participants) {
    const participantKeys = getParticipantMatchKeys(participant);
    for (const key of participantKeys) {
      if (wanted.has(key)) {
        return participant;
      }
    }
  }

  return null;
}

export function isGroupMetadataOwner(metadata = {}, values = []) {
  const candidates = Array.isArray(values) ? values : [values];
  const wanted = new Set();

  for (const value of candidates) {
    for (const key of getMatchKeys(value)) {
      wanted.add(key);
    }
  }

  if (!wanted.size) {
    return false;
  }

  const ownerCandidates = [
    metadata?.owner,
    metadata?.ownerAlt,
    metadata?.subjectOwner,
    metadata?.subjectOwnerAlt,
    metadata?.descOwner,
    metadata?.descOwnerAlt,
  ];

  for (const value of ownerCandidates) {
    for (const key of getMatchKeys(value)) {
      if (wanted.has(key)) {
        return true;
      }
    }
  }

  return false;
}

export function buildJidCandidates(value = "") {
  const values = [];

  for (const raw of extractValueCandidates(value)) {
    const normalized = normalizeJidUser(raw);
    const digits = normalizeJidDigits(raw);
    const looksPhoneLike =
      /^\+?\d+$/.test(raw) ||
      /^\d+(?:@s\.whatsapp\.net)?$/i.test(raw) ||
      /^\d+@lid$/i.test(raw) ||
      /^\d+$/.test(normalized);

    if (raw.includes("@")) {
      values.push(raw);
    }

    if (looksPhoneLike && digits) {
      values.push(`${digits}@s.whatsapp.net`, `${digits}@lid`);
    }
  }

  return uniqueValues(values);
}

export function getParticipantActionCandidates(
  metadata = {},
  participant = null,
  fallbackValues = []
) {
  const preferLid = String(metadata?.addressingMode || "").trim().toLowerCase() === "lid";
  const candidates = [];

  const push = (value = "") => {
    for (const raw of extractValueCandidates(value)) {
      candidates.push(raw);
    }
  };

  if (participant) {
    if (preferLid) {
      push(participant?.lid);
      push(participant?.id);
    } else {
      push(participant?.id);
      push(participant?.lid);
    }
  }

  for (const value of Array.isArray(fallbackValues) ? fallbackValues : [fallbackValues]) {
    push(value);
    for (const candidate of buildJidCandidates(value)) {
      push(candidate);
    }
  }

  return uniqueValues(candidates);
}

export function getParticipantMentionJid(metadata = {}, participant = null, fallbackValue = "") {
  return (
    getParticipantActionCandidates(metadata, participant, fallbackValue)[0] || ""
  );
}

export async function runGroupParticipantAction(
  sock,
  groupId,
  metadata = {},
  participant = null,
  fallbackValues = [],
  action = "remove"
) {
  const candidates = getParticipantActionCandidates(
    metadata,
    participant,
    fallbackValues
  );
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const result = await sock.groupParticipantsUpdate(groupId, [candidate], action);
      const ok =
        !Array.isArray(result) ||
        result.some((entry) => String(entry?.status || "200").trim() === "200");

      if (ok) {
        return {
          ok: true,
          jid: candidate,
          result,
        };
      }

      lastError = new Error(
        `No pude ejecutar ${action} para ${candidate}.`
      );
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    candidates,
    error: lastError,
  };
}

export function getParticipantDisplayTag(participant = null, fallbackValue = "") {
  const digits =
    normalizeJidDigits(participant?.id) ||
    normalizeJidDigits(participant?.lid) ||
    normalizeJidDigits(participant) ||
    normalizeJidDigits(fallbackValue);

  if (digits) {
    return `@${digits}`;
  }

  const normalized =
    normalizeJidUser(participant?.id) ||
    normalizeJidUser(participant?.lid) ||
    normalizeJidUser(participant) ||
    normalizeJidUser(fallbackValue);

  return normalized ? `@${normalized}` : "@usuario";
}

function getContextInfo(message = {}) {
  const candidates = [
    message?.extendedTextMessage?.contextInfo,
    message?.imageMessage?.contextInfo,
    message?.videoMessage?.contextInfo,
    message?.documentMessage?.contextInfo,
    message?.buttonsResponseMessage?.contextInfo,
    message?.templateButtonReplyMessage?.contextInfo,
    message?.listResponseMessage?.contextInfo,
    message?.interactiveResponseMessage?.contextInfo,
  ];

  return candidates.find((value) => value && typeof value === "object") || {};
}

export function extractTargetCandidates(message = {}, args = []) {
  const contextInfo = getContextInfo(message?.message || message || {});
  const mentioned = Array.isArray(contextInfo?.mentionedJid)
    ? contextInfo.mentionedJid
    : [];
  const values = [];
  const push = (value = "") => {
    for (const candidate of extractValueCandidates(value)) {
      values.push(candidate);
    }
  };

  for (const value of mentioned) {
    push(value);
  }
  push(contextInfo?.participant);
  push(contextInfo?.participantAlt || contextInfo?.participantPn);
  push(contextInfo?.participantLid);
  push(message?.quoted?.sender);
  push(message?.quoted?.senderPhone);
  push(message?.quoted?.senderLid);
  push(message?.quoted?.key?.participant);
  push(message?.quoted?.key?.participantAlt);
  push(message?.quoted?.key?.participantPn);
  push(message?.quoted?.key?.participantLid);

  const firstArg = String((Array.isArray(args) ? args[0] : args) || "").trim();
  if (firstArg) {
    values.push(firstArg);
  }

  return uniqueValues(values);
}

export function resolveGroupTarget(metadata = {}, message = {}, args = []) {
  const candidates = extractTargetCandidates(message, args);
  const participant = findGroupParticipant(metadata, candidates);
  const jid = getParticipantMentionJid(metadata, participant, candidates[0] || "");

  return {
    participant,
    jid,
    candidates,
  };
}
