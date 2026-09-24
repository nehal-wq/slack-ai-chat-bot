require("dotenv").config();

const express = require("express");
const OpenAI = require("openai");
const cors = require("cors");
const { App: SlackApp } = require("@slack/bolt");

const app = express();
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY
});

const slackApp = new SlackApp({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

app.use(cors());
app.use(express.json());
const slackHistory = new Map();
async function getAIResponse(messages) {
  const response =
    await openai.chat.completions.create({
      model: "openrouter/free",
      messages: messages
    });
    const reply=response.choices?.[0]?.message?.content;
  if(!reply){
    throw new Error("AI returned an empty response")
  }
  return reply
}
app.get("/api", (req, res) => {
  res.json({
    message: "AI Chat Backend is working!"
  });
});

app.post("/api/chat", async (req, res) => {
  try {

    const message = req.body.message;
    const history = req.body.history || [];

    if (!message) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    const messages = [
      {
        role: "system",
        content:
          "You are a helpful AI assistant inside a Slack-style chat application."
      },

      ...history,

      {
        role: "user",
        content: message
      }
    ];

    const reply =
      await getAIResponse(messages);

    res.json({
      reply: reply
    });

  } catch (error) {

    console.error("STATUS:", error.status);
    console.error("MESSAGE:", error.message);
    console.error("ERROR:", error.error);

    res.status(500).json({
      error: error.message
    });
  }
});
slackApp.event(
  "app_mention",
  async ({ event, say }) => {

    try {

      console.log(
        "SLACK MESSAGE RECEIVED:",
        event.text
      );
      const channelId = event.channel;
      let history =
        slackHistory.get(channelId);
      if (!history) {

        history = [];

        slackHistory.set(
          channelId,
          history
        );
      }
      const cleanMessage =
        event.text
          .replace(/<@[^>]+>/g, "")
          .trim();


      console.log(
        "CLEAN MESSAGE:",
        cleanMessage
      );
      history.push({
        role: "user",
        content: cleanMessage
      });
      const messages = [

        {
          role: "system",
          content:
            "You are a helpful AI assistant inside a Slack workspace. Remember and use the previous conversation when answering follow-up questions."
        },

        ...history

      ];


      console.log(
        "MESSAGES SENT TO AI:",
        JSON.stringify(
          messages,
          null,
          2
        )
      );
      const reply =
        await getAIResponse(messages);

      history.push({
        role: "assistant",
        content: reply
      });

      await say(reply);

    } catch (error) {

      console.error(
        "SLACK ERROR:",
        error.message
      );

      await say(
        "Sorry, I couldn't process your request right now."
      );
    }
  }
);
app.listen(5000, () => {

  console.log(
    "Server running on port 5000"
  );

});
(async () => {
  try {
    await slackApp.start();
    console.log(
      "Slack bot is running!"
    );

  } catch (error) {
    console.error(
      "SLACK START ERROR:",
      error.message
    );

  }

})();