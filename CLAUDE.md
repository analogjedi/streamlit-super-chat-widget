# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Streamlit custom component that provides an enhanced chat input widget with image paste, file attachments, drag-and-drop, and input history navigation. It bridges a Python Streamlit component with a React/TypeScript frontend.

## Development Commands

```bash
# Install frontend dependencies
cd custom_chat_input/frontend && npm install

# Development mode (requires two terminals):
# 1. Start React dev server (port 3001)
cd custom_chat_input/frontend && npm start
# 2. Run Streamlit app (connects to React dev server)
streamlit run app.py

# Production build
cd custom_chat_input/frontend && npm run build

# Install Python dependencies
pip install -r requirements.txt
```

**Dev/prod toggle:** Set `_RELEASE = False` in `custom_chat_input/__init__.py` for development mode (connects to localhost:3001). Set `_RELEASE = True` for production (serves from `frontend/build/`).

## Architecture

**Data flow:** Python app calls `custom_chat_input()` → Streamlit component bridge → React `CustomChatInput.tsx` renders the widget → user interactions (typing, paste, file upload, drag-drop) are processed → `Streamlit.setComponentValue()` sends `{text, images[], history[]}` dict back to Python.

**Key files:**
- `custom_chat_input/__init__.py` — Python component declaration, exports `custom_chat_input()` and `decode_image()`. Handles dev/prod mode switching.
- `custom_chat_input/frontend/src/CustomChatInput.tsx` — All UI logic: textarea with auto-resize, clipboard paste interception, file-to-base64 conversion, drag-drop handling, input history navigation (Up/Down arrows), and Streamlit theme integration.
- `app.py` — Demo app showing the widget with deduplication pattern, submission history display, and session state management.

**Styling:** Inline CSS-in-JS using `React.CSSProperties`. Theme colors come from Streamlit's theme object (`primaryColor`, `secondaryBackgroundColor`, `textColor`). Icons are inline SVGs.

**Frontend toolchain:** Create React App (react-scripts), TypeScript, React 18. Production build outputs to `custom_chat_input/frontend/build/`.

## Important Patterns

- **Deduplication:** The demo app uses a `last_processed_submission` key in `st.session_state` to prevent reprocessing on Streamlit reruns. This pattern is essential for any app using this component.
- **File encoding:** Attached files are converted to base64 with metadata (name, type, size, is_image flag). Use `decode_image()` helper to convert back to bytes.
- **Input history:** Previous inputs are stored in `st.session_state` and passed back to the React component via the `history` prop for Up/Down arrow navigation.
