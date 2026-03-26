# Streamlit Super Chat Widget

A custom Streamlit chat input component built with React and TypeScript that extends the default `st.chat_input` with features missing from the stock widget:

- **Clipboard image paste** — Ctrl+V / Cmd+V pastes images directly into the input
- **File attachments** — paperclip button for uploading any file type
- **Drag & drop** — drop images or files onto the input area
- **Input history** — Up/Down arrow keys cycle through previous entries (like a terminal)
- **Auto-resizing textarea** — grows with content, up to a max height
- **Theme-aware** — inherits your Streamlit theme colors automatically

## Quick Start

```bash
git clone https://github.com/analogjedi/streamlit-super-chat-widget.git
cd streamlit-super-chat-widget
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

## Project Structure

```
streamlit-super-chat-widget/
├── app.py                          # Demo app with running submission log
├── requirements.txt                # Python dependencies (streamlit)
├── custom_chat_input/
│   ├── __init__.py                 # Python API: custom_chat_input() + decode_image()
│   └── frontend/
│       ├── src/
│       │   ├── CustomChatInput.tsx  # React component (the widget itself)
│       │   └── index.tsx            # React entry point
│       ├── build/                   # Pre-built production bundle (ready to use)
│       ├── public/
│       │   └── index.html           # HTML template
│       ├── package.json             # Node dependencies
│       └── tsconfig.json            # TypeScript config
```

## Basic Usage

Drop the `custom_chat_input/` folder into your Streamlit project and import it:

```python
import streamlit as st
from custom_chat_input import custom_chat_input, decode_image

# Initialize history in session state
if "input_history" not in st.session_state:
    st.session_state.input_history = []

# Render the widget
result = custom_chat_input(
    placeholder="Type a message or paste an image...",
    key="my_chat",
    history=st.session_state.input_history,
)

if result is not None:
    text = result["text"]       # str — the message text
    files = result["images"]    # list of dicts — attached files/images

    st.write(f"You said: {text}")

    for f in files:
        if f["is_image"]:
            image_bytes = decode_image(f)
            st.image(image_bytes, caption=f["name"])
```

### Handling the Result

The component returns `None` until the user submits. On submit, you get a dict:

```python
{
    "text": "hello world",          # str — message text (may be empty)
    "images": [                     # list — attached files (may be empty)
        {
            "name": "screenshot.png",
            "type": "image/png",
            "data": "iVBORw0KGgo...",  # base64-encoded file content
            "size": 48210,              # file size in bytes
            "is_image": True            # True for images, False for other files
        }
    ],
    "history": ["prev msg 1", ...]  # list — current input history
}
```

### Deduplication (Important)

Streamlit custom components persist their last value across reruns. You **must** deduplicate to avoid infinite rerun loops:

```python
if "last_processed" not in st.session_state:
    st.session_state.last_processed = None

result = custom_chat_input(key="chat", history=st.session_state.input_history)

if result is not None:
    fingerprint = (result.get("text", ""), len(result.get("images", [])))
    if fingerprint != st.session_state.last_processed:
        st.session_state.last_processed = fingerprint
        # Process the submission here
        st.rerun()
```

## Advanced Usage

### API Parameters

```python
custom_chat_input(
    placeholder="Type here...",         # Placeholder text
    key="unique_key",                   # Streamlit widget key (required if multiple instances)
    max_chars=500,                      # Character limit (0 = unlimited)
    max_image_size_mb=10,               # Max file size in MB (default 5)
    accepted_image_types=[              # MIME types accepted for paste (not file picker)
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
    ],
    history=["prev 1", "prev 2"],       # Input history for up-arrow navigation
)
```

### Sending Images to an LLM

```python
import base64
from custom_chat_input import custom_chat_input, decode_image

result = custom_chat_input(key="chat", history=st.session_state.input_history)

if result is not None:
    messages = [{"role": "user", "content": []}]

    if result["text"]:
        messages[0]["content"].append({
            "type": "text",
            "text": result["text"]
        })

    for img in result["images"]:
        if img["is_image"]:
            messages[0]["content"].append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{img['type']};base64,{img['data']}"
                }
            })

    # Send to OpenAI, Anthropic, etc.
    response = client.chat.completions.create(model="gpt-4o", messages=messages)
```

### Saving Uploaded Files to Disk

```python
from custom_chat_input import decode_image

for f in result["images"]:
    file_bytes = decode_image(f)
    with open(f"uploads/{f['name']}", "wb") as fp:
        fp.write(file_bytes)
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Up Arrow` | Previous history entry (when cursor is at start) |
| `Down Arrow` | Next history entry (when cursor is at end) |
| `Ctrl/Cmd+V` | Paste image from clipboard |

### Rebuilding the Frontend

If you modify `CustomChatInput.tsx`, rebuild the production bundle:

```bash
cd custom_chat_input/frontend
npm install
GENERATE_SOURCEMAP=false npm run build
```

### Development Mode

For live-reloading during frontend development:

1. In `custom_chat_input/__init__.py`, set `_RELEASE = False`
2. Start the dev server:
   ```bash
   cd custom_chat_input/frontend
   npm start
   ```
3. In another terminal: `streamlit run app.py`

The component will load from `localhost:3001` instead of the static build.

## How It Works

This is a [Streamlit custom component](https://docs.streamlit.io/develop/concepts/custom-components) using `streamlit-component-lib` for bidirectional communication between Python and a React frontend.

The React component renders inside an iframe. When the user submits, it calls `Streamlit.setComponentValue()` which sends the data (text + base64-encoded files) back to the Python side as the return value of `custom_chat_input()`.

Image paste works by intercepting the browser's `paste` event on the textarea and reading image data from `ClipboardEvent.clipboardData`. File uploads use a hidden `<input type="file">` triggered by the paperclip button.

## License

MIT
