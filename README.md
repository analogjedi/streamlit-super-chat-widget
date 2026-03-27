# Streamlit Super Chat Widget

A custom Streamlit chat input component built with React and TypeScript that extends the default `st.chat_input` with features missing from the stock widget — and eliminates the **Axios-500 file upload error** that affects Kubernetes and load-balanced deployments.

- **Clipboard image paste** — Ctrl+V / Cmd+V pastes images directly into the input
- **File attachments** — paperclip button for uploading any file type
- **Drag & drop** — drop images or files onto the input area
- **Input history** — Up/Down arrow keys cycle through previous entries (like a terminal)
- **Command autocomplete** — type `/` or `@` to get a filtered popup of available commands
- **Auto-resizing textarea** — grows with content, up to a max height
- **Upload feedback** — "Sending..." overlay for large file transfers (>1MB)
- **Theme-aware** — inherits your Streamlit theme colors automatically
- **Kubernetes safe** — no sticky sessions required (see below)

## Why Not `st.chat_input`?

### The Kubernetes Axios-500 Problem

Streamlit's built-in `chat_input` (with `accept_file`) uploads files via **separate HTTP PUT requests** to `/_stcore/upload_file/{session_id}/{file_id}`. When deployed behind a load balancer (Kubernetes, AWS ELB, etc.), these PUT requests can be routed to a **different pod** than the one holding the user's session:

```
AxiosError: Request failed with status code 500
```

The standard workaround is enabling sticky sessions on the load balancer, which adds operational complexity and can cause uneven load distribution.

### How This Component Avoids It

This component sends **all data through the Streamlit WebSocket** via `Streamlit.setComponentValue()`. Files are base64-encoded in the browser and included in the component value alongside the text. Since the WebSocket is a single persistent connection, there are no separate HTTP requests for a load balancer to misroute.

| | `st.chat_input` | `custom_chat_input` |
|---|---|---|
| File transfer method | HTTP PUT (separate requests) | WebSocket (single connection) |
| K8s sticky sessions required | Yes | **No** |
| Axios-500 risk | Yes | **No** |
| Upload progress | Native browser progress | "Sending..." overlay (files >1MB) |

### Trade-offs

- **Base64 overhead** — files are ~33% larger in transit (a 10MB file becomes ~13.3MB over the WebSocket)
- **No per-byte progress** — the WebSocket transfer is all-or-nothing; for files >1MB a "Sending..." overlay provides visual feedback
- **Browser memory** — large files are held as base64 strings in memory until submission

### How the Upload Overlay Works

For large file attachments (>1MB total), the component shows a "Sending..." overlay on the input area during the transfer and processing cycle. This uses a **skip-one-rerun technique** to persist through Streamlit's rerun lifecycle:

1. User clicks Submit with files >1MB attached
2. Component shows "Sending..." overlay and sets a flag to skip the next args update
3. `setComponentValue()` sends the base64 payload and triggers **Rerun A** (the immediate rerun)
4. **Rerun A**: component receives new args but the skip flag prevents clearing the overlay
5. Your app processes the result and calls `st.rerun()`, triggering **Rerun B**
6. **Rerun B**: component receives args again, skip flag is consumed, overlay clears

For text-only or small file submissions (<1MB), processing is fast enough that the overlay is not shown — avoiding a React 18 batching edge case where both reruns merge into a single render cycle.

A 2-minute safety timeout ensures the overlay clears even if `st.rerun()` is never called.

> **Important**: Your app must call `st.rerun()` after processing a submission for the overlay to clear promptly. This is already standard practice for the required deduplication pattern (see below).

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
    slash_commands=["help", "clear"],    # Commands shown when user types '/'
    at_commands=["assistant", "user"],   # Commands shown when user types '@'
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
| `Enter` | Send message (or select command when popup is open) |
| `Shift+Enter` | New line |
| `Up Arrow` | Previous history entry (or navigate popup up) |
| `Down Arrow` | Next history entry (or navigate popup down) |
| `Tab` | Select highlighted command (when popup is open) |
| `Escape` | Dismiss command popup |
| `Ctrl/Cmd+V` | Paste image from clipboard |

### Command Autocomplete

Provide lists of slash commands and/or at-commands to enable an autocomplete popup. When the user types `/` or `@` at the start of their input, a filtered list of matching commands appears above the input.

```python
result = custom_chat_input(
    placeholder="Type a message, /command, or @mention...",
    key="chat",
    history=st.session_state.input_history,
    slash_commands=["help", "clear", "reset", "settings", "export", "history"],
    at_commands=["assistant", "user", "system", "everyone"],
)
```

Commands are passed **without** the prefix character. The popup displays the prefix automatically (e.g., `/help`, `@assistant`).

**Behavior:**
- Typing `/` shows all slash commands; typing `/he` filters to matches containing "he"
- Same for `@` with at-commands
- Arrow keys navigate the popup, Enter or Tab selects, Escape dismisses
- Selecting a command fills the input with the command followed by a space, so the user can continue typing arguments
- The popup closes automatically once a space or newline follows the command
- When no command lists are provided, the feature is completely inactive — zero behavioral change

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

## Integration Example — Streamlit Chat App with Bottom Pinning

### Bottom-of-Page Positioning

Streamlit's native `st.chat_input()` auto-pins to the viewport bottom. Custom
components render inline by default. To get the same fixed-bottom behavior, render
inside `st._bottom` — Streamlit's internal bottom delta generator:

```python
import streamlit as st
from custom_chat_input import custom_chat_input

with st._bottom:
    result = custom_chat_input(
        placeholder="Type a message...",
        key="main_chat_input",
    )
```

`st._bottom` uses the same `RootContainer.BOTTOM` mechanism that `st.chat_input()`
uses internally. No custom CSS is needed.

### Deduplication (Required)

Streamlit custom components retain their last return value across reruns. Without
deduplication, every `st.rerun()` will re-process the previous submission.

```python
import streamlit as st
from custom_chat_input import custom_chat_input

# Initialize session state
if "chat_widget_last_fingerprint" not in st.session_state:
    st.session_state["chat_widget_last_fingerprint"] = None
if "chat_input_history" not in st.session_state:
    st.session_state["chat_input_history"] = []

# Render widget
with st._bottom:
    result = custom_chat_input(
        placeholder="Type a message...",
        history=st.session_state.get("chat_input_history", []),
        key="main_chat_input",
    )

# Process only genuinely new submissions
if result is not None:
    fingerprint = (
        result.get("text", ""),
        len(result.get("images", [])),
        "|".join(f.get("name", "") for f in result.get("images", [])),
    )
    if fingerprint != st.session_state.get("chat_widget_last_fingerprint"):
        st.session_state["chat_widget_last_fingerprint"] = fingerprint

        # Process the submission
        text = result.get("text", "")
        images = result.get("images", [])

        # Update input history
        if text.strip():
            hist = st.session_state["chat_input_history"]
            if text in hist:
                hist.remove(text)
            hist.append(text)
            st.session_state["chat_input_history"] = hist[-50:]

        # Your processing logic here
        st.write(f"Message: {text}")
        st.write(f"Attachments: {len(images)}")
```

### Adapter for File Processing Pipelines

If your app has existing file processing that expects Streamlit's `UploadedFile`
interface (`.name`, `.type`, `.read()`, `.seek()`, `.getvalue()`), use this adapter
to create compatible objects from the widget's base64 return data:

```python
import base64
import io
from typing import Optional


class WidgetUploadedFile(io.BytesIO):
    """Mimics Streamlit's UploadedFile from widget base64 data.

    Extends io.BytesIO for universal compatibility with PIL.Image.open(),
    pandas.read_csv(), PdfReader(), and any library that reads file-like objects.
    """

    def __init__(self, name: str, data: bytes, file_type: str, size: int):
        super().__init__(data)
        self.name = name
        self.type = file_type
        self.size = size


class WidgetPrompt:
    """Matches st.chat_input() return interface: .text and .files"""

    def __init__(self, text: str, files: Optional[list] = None):
        self.text = text
        self.files = files


def translate_widget_result(result: dict) -> WidgetPrompt:
    """Convert custom_chat_input() return dict into a WidgetPrompt.

    All attachments (images and non-image files) are in result["images"],
    distinguished by the "is_image" flag. Data is pure base64 (no data URI prefix).
    """
    text = result.get("text", "")
    files = []

    for attachment in result.get("images", []):
        raw_bytes = base64.b64decode(attachment["data"])
        files.append(
            WidgetUploadedFile(
                name=attachment.get("name", "file"),
                data=raw_bytes,
                file_type=attachment.get("type", "application/octet-stream"),
                size=attachment.get("size", len(raw_bytes)),
            )
        )

    return WidgetPrompt(text=text, files=files if files else None)
```

Usage with the adapter:

```python
if result is not None and fingerprint != last_fingerprint:
    prompt = translate_widget_result(result)

    if prompt.files:
        for f in prompt.files:
            st.write(f"File: {f.name} ({f.type}, {f.size} bytes)")
            # f is a BytesIO — pass directly to PIL, pandas, etc.
```

### Summary

The three key pieces for integration are:
1. **`st._bottom`** for viewport-bottom positioning
2. **Fingerprint dedup** to prevent reprocessing on reruns
3. **`WidgetUploadedFile(io.BytesIO)`** adapter for downstream compatibility

## How It Works

This is a [Streamlit custom component](https://docs.streamlit.io/develop/concepts/custom-components) using `streamlit-component-lib` for bidirectional communication between Python and a React frontend.

The React component renders inside an iframe. When the user submits, it calls `Streamlit.setComponentValue()` which sends the data (text + base64-encoded files) back to the Python side as the return value of `custom_chat_input()`.

Image paste works by intercepting the browser's `paste` event on the textarea and reading image data from `ClipboardEvent.clipboardData`. File uploads use a hidden `<input type="file">` triggered by the paperclip button.

## License

MIT
