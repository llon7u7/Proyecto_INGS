export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { imageBase64, prompt } = req.body;
  
  // Tu llave de Groq (gsk_...)
  const API_KEY = "process.env.GROQ_API_KEY"; 

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        // 💡 ESTE ES EL MODELO QUE ESTÁ FUNCIONANDO AHORA
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt + " Responde únicamente el objeto JSON puro." },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
            ]
          }
        ],
        temperature: 0.1
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    // Limpieza de seguridad: Groq a veces envía basura antes del JSON
    let content = data.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) content = jsonMatch[0];

    res.status(200).json({
      choices: [{
        message: { content: content }
      }]
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}