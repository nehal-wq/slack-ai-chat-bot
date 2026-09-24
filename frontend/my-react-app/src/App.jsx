import { useState,useEffect,useRef } from "react";

import {
  Layout,
  Menu,
  List,
  Avatar,
  Input,
  Button,
  Spin,
  Alert
} from "antd";

import {
  useSelector,
  useDispatch
} from "react-redux";

import {
  addMessage,
  sendMessage,
  clearMessages
} from "./features/chat/chatSlice";

const { Header, Sider, Content } = Layout;

function App() {
  const [input, setInput] = useState("");
  const messages = useSelector(
    (state) => state.chat.messages
  );
  const messagesEndRef = useRef(null);
  useEffect(()=>{
    messagesEndRef.current?.scrollIntoView({
      behavior:"smooth"
    })
  },[messages])
  const loading = useSelector(
    (state) => state.chat.loading
  );
  const error=useSelector((state)=>state.chat.error)
  const dispatch = useDispatch();

  function handleSend() {
    if (input.trim() === "") {
      return;
    }
    const history = messages.map((message) => ({
      role:
        message.sender === "user"
          ? "user"
          : "assistant",

      content: message.text
    }));
    dispatch(
      addMessage({
        sender: "user",
        text: input
      })
    );
    dispatch(
      sendMessage({
        message: input,
        history: history
      })
    );
    setInput("");
  }

  function handleClear() {
    dispatch(clearMessages());
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider>

        <h2
          style={{
            color: "white",
            padding: "20px"
          }}
        >
          My Slack
        </h2>

        <Menu
          theme="dark"
          mode="inline"
          items={[
            {
              key: "chat",
              label: "AI Chat"
            },
            {
              key: "general",
              label: "General"
            },
            {
              key: "settings",
              label: "Settings"
            }
          ]}
        />

      </Sider>

      <Layout>
        <Header
          style={{
            color: "white",
            fontSize: "18px",
            fontWeight: "bold"
          }}
        >
          AI Chat
        </Header>
        <Content
          style={{
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            height: "calc(100vh - 64px)"
          }}
        >
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding:"10px"
            }}
          >

            <List
              dataSource={messages}

              renderItem={(message) => (
  <List.Item
    style={{
      border: "none",
      padding: "10px 0",
      display: "flex",
      justifyContent:
        message.sender === "user"
          ? "flex-end"
          : "flex-start"
    }}
  >
    <div
      style={{
        display: "flex",
        flexDirection:
          message.sender === "user"
            ? "row-reverse"
            : "row",
        alignItems: "flex-start",
        gap: "10px",
        maxWidth: "70%"
      }}
    >
      <Avatar>
        {message.sender === "user" ? "U" : "AI"}
      </Avatar>

      <div>
        <div
          style={{
            fontWeight: "bold",
            marginBottom: "4px"
          }}
        >
          {message.sender === "user"
            ? "You"
            : "AI Bot"}
        </div>

        <div
          style={{
            fontSize: "15px",
            padding: "10px 14px",
            background:
              message.sender === "user"
                ? "#f0f0f0"
                : "#e6f4ff",
            borderRadius: "8px",
            wordBreak: "break-word"
          }}
        >
          {message.text}
        </div>
      </div>
    </div>
  </List.Item>
)}
            />
             <div ref={messagesEndRef} />
            {loading && (
             <div
              style={{
                    padding: "10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px"
                      }}
                    >
                <Spin />

                <span
                  style={{
                    marginLeft: "10px"
                  }}
                >
                  AI is typing...
                </span>

              </div>
            )}
          {error && (
            <Alert
            message="AI Error"
            description={error}
            type="error"
            showIcon style={{marginTop:"10px"}}
            />
          )}
          </div>
          <div
            style={{
              display: "flex",
              gap: "10px",
              marginTop: "20px",
              padding: "10px",
              borderTop: "1px solid #ddd",
              background: "white",
              borderRadius: "8px"
            }}
          >

            <Input
              placeholder="Message AI..."
              value={input}

              onChange={(event) =>
                setInput(event.target.value)
              }

              onPressEnter={handleSend}
            />

            <Button
              type="primary"
              onClick={handleSend}
              loading={loading}
              disabled={loading || input.trim()===""}
            >
              Send
            </Button>

            <Button
              danger
              onClick={handleClear}
              disabled={messages.length===0}
            >
              Clear
            </Button>

          </div>

        </Content>

      </Layout>

    </Layout>
  );
}

export default App;