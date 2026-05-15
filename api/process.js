export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const url  = req.query.url  || "";
  const text = req.query.text || "";

  if (!url) return res.status(400).json({ error: "url_required" });

  let rawText = text;

  if (!rawText) {
    try {
      const pageRes = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "fr-CA,fr;q=0.9,en;q=0.8"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(8000)
      });
      const html = await pageRes.text();
      rawText = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000);
    } catch (e) {
      return res.status(422).json({ error: "fetch_failed", message: e.message });
    }
  }

  if (rawText.length < 100) {
    return res.status(422).json({ error: "insufficient_content" });
  }

  const prompt = `Tu es un extracteur d'offres d'emploi. Extrais les informations du texte brut et retourne UNIQUEMENT un objet JSON valide (zero markdown, zero explication) avec ces champs :
- "poste" : titre exact du poste
- "entreprise" : nom de l'entreprise
- "lieu" : ville / region / mode de travail (ex: "Montreal, hybride 3j/sem")
- "date_publication" : quand l'offre a ete publiee (texte exact ou date), ou ""
- "deadline" : date limite de candidature YYYY-MM-DD, ou ""
- "type_poste" : type de contrat (ex: "Permanent", "Contractuel 12 mois", "Stage"), ou ""
- "contexte" : contexte de l'organisation et raison de l'embauche (300 mots max)
- "mission" : responsabilites et description du role (300 mots max)
- "qualifications" : exigences, competences, diplomes requis (200 mots max)
- "autres" : salaire, avantages, conditions de travail (100 mots max)

URL: ${url}

Texte :
${rawText}`;

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const result = await claudeRes.json();
  if (result.error) return res.status(500).json({ error: result.error.message });

  const raw = result.content[0].text;
  const match = raw.match(/\{[\s\S]+\}/);
  if (!match) return res.status(500).json({ error: "invalid_ai_response" });

  return res.status(200).json(JSON.parse(match[0]));
}
