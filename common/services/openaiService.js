// services/openaiService.js
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function askGPT() {
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "user",
        content: "",
      },
    ],
  });

  console.log(response.choices[0].message.content);
}

// разместить там, где нужно вывести askGPT();
