// POST /api/contact — envoie la question du formulaire de la landing par email (Resend).
// Aucune dépendance npm : fetch est natif dans le runtime Node de Vercel.
// Aucune donnée n'est stockée.

const FIELDS = ['prenom', 'nom', 'sport', 'club', 'message'];
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 2000;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (err) {
      return null;
    }
  }
  return req.body;
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Un sujet d'email ne doit contenir ni retour à la ligne ni caractère de contrôle.
function subjectSafe(value) {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').slice(0, 120);
}

function row(label, value) {
  return `
          <tr>
            <td style="padding:0 0 14px 0;">
              <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7A8496;font-weight:700;">${escapeHtml(label)}</div>
              <div style="font-size:17px;color:#0F1319;font-weight:700;margin-top:2px;">${escapeHtml(value)}</div>
            </td>
          </tr>`;
}

function buildHtml(data) {
  const message = escapeHtml(data.message).replace(/\r?\n/g, '<br>');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Landing — nouvelle question</title>
</head>
<body style="margin:0;padding:0;background:#FBFBFC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FBFBFC;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #E4E6EB;border-radius:10px;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        <tr>
          <td style="padding:22px 24px;border-bottom:3px solid #f97316;">
            <div style="font-size:22px;font-weight:800;letter-spacing:-.03em;color:#0F1319;">Sport<span style="color:#f97316;">siders</span></div>
            <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#7A8496;font-weight:700;margin-top:4px;">Landing — nouvelle question</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row('Prénom', data.prenom)}${row('Nom', data.nom)}${row('Sport', data.sport)}${row('Club', data.club)}
              <tr>
                <td style="padding:6px 0 0 0;">
                  <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7A8496;font-weight:700;margin-bottom:8px;">Question</div>
                  <div style="font-size:17px;line-height:1.5;color:#3A4252;background:#FBFBFC;border:1px solid #E4E6EB;border-radius:8px;padding:16px;">${message}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 22px 24px;font-size:13px;color:#7A8496;">
            Envoyé depuis le formulaire de www.sportsiders.app
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildText(data) {
  return [
    `Prénom : ${data.prenom}`,
    `Nom : ${data.nom}`,
    `Sport : ${data.sport}`,
    `Club : ${data.club}`,
    '',
    'Question :',
    data.message,
    '',
    'Envoyé depuis le formulaire de www.sportsiders.app'
  ].join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = readBody(req);
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'invalid_body' });
  }

  // Honeypot : un bot remplit le champ caché. On répond OK sans rien envoyer.
  if (clean(body.website)) {
    return res.status(200).json({ ok: true });
  }

  const data = {};
  for (const field of FIELDS) {
    data[field] = clean(body[field]);
    if (!data[field]) {
      return res.status(400).json({ ok: false, error: 'missing_field', field });
    }
  }

  if (data.message.length < MESSAGE_MIN || data.message.length > MESSAGE_MAX) {
    return res.status(400).json({ ok: false, error: 'invalid_message' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO;
  const from = process.env.CONTACT_FROM;

  if (!apiKey || !to || !from) {
    console.error('contact: configuration Resend incomplète');
    return res.status(500).json({ ok: false, error: 'not_configured' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: subjectSafe(`Landing — question de ${data.prenom} ${data.nom} (${data.club})`),
        html: buildHtml(data),
        text: buildText(data)
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('contact: Resend a répondu', response.status, detail);
      return res.status(500).json({ ok: false, error: 'send_failed' });
    }
  } catch (err) {
    console.error('contact: appel Resend impossible', err);
    return res.status(500).json({ ok: false, error: 'send_failed' });
  }

  return res.status(200).json({ ok: true });
};
