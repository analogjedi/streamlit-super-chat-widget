"""
Demo Streamlit app showcasing the custom chat input component.

Features demonstrated:
- Paste images from clipboard (Ctrl+V / Cmd+V)
- Navigate input history with Up/Down arrow keys
- Drag and drop images onto the input
- Running output list to verify submissions
"""

import streamlit as st
import base64
from datetime import datetime
from custom_chat_input import custom_chat_input, decode_image

st.set_page_config(
    page_title="Custom Chat Input Demo",
    page_icon="💬",
    layout="centered",
)

st.title("Custom Chat Input Demo")
st.caption(
    "Features: **Paste images** (Ctrl+V) · **Input history** (Up/Down arrows) · **Drag & drop** images"
)

# Initialize session state
if "submissions" not in st.session_state:
    st.session_state.submissions = []
if "input_history" not in st.session_state:
    st.session_state.input_history = []
if "last_processed" not in st.session_state:
    st.session_state.last_processed = None

# Custom chat input
result = custom_chat_input(
    placeholder="Type a message or paste an image (Ctrl+V)...",
    key="chat_input",
    history=st.session_state.input_history,
)

if result is not None:
    # Deduplicate: Streamlit custom components return the same value on every
    # rerun until a new setComponentValue call. We fingerprint by text + image
    # count + timestamp-bucket so we only process each submission once.
    fingerprint = (result.get("text", ""), len(result.get("images", [])))

    if fingerprint != st.session_state.last_processed:
        st.session_state.last_processed = fingerprint

        text = result.get("text", "")
        images = result.get("images", [])

        # Update input history
        if text:
            hist = st.session_state.input_history
            if text in hist:
                hist.remove(text)
            hist.append(text)
            st.session_state.input_history = hist[-50:]

        # Record the submission
        st.session_state.submissions.append({
            "time": datetime.now().strftime("%H:%M:%S"),
            "text": text,
            "images": images,
            "entry_num": len(st.session_state.submissions) + 1,
        })

        st.rerun()

# --- Running output list ---
st.divider()

col1, col2 = st.columns([3, 1])
with col1:
    st.subheader("Submissions")
with col2:
    if st.button("Clear", use_container_width=True):
        st.session_state.submissions = []
        st.session_state.input_history = []
        st.rerun()

if not st.session_state.submissions:
    st.info("No submissions yet. Type something above and press Enter!")
else:
    for sub in reversed(st.session_state.submissions):
        with st.container(border=True):
            header = f"**#{sub['entry_num']}** — `{sub['time']}`"
            if sub["text"]:
                header += f"  \n{sub['text']}"
            st.markdown(header)

            if sub["images"]:
                img_files = [f for f in sub["images"] if f.get("is_image", True)]
                other_files = [f for f in sub["images"] if not f.get("is_image", True)]

                if img_files:
                    img_cols = st.columns(min(len(img_files), 3))
                    for idx, img in enumerate(img_files):
                        with img_cols[idx % 3]:
                            st.image(
                                base64.b64decode(img["data"]),
                                caption=img["name"],
                                use_container_width=True,
                            )

                if other_files:
                    for f in other_files:
                        size_kb = f["size"] / 1024
                        size_str = f"{size_kb:.1f} KB" if size_kb < 1024 else f"{size_kb/1024:.1f} MB"
                        st.markdown(f"📎 **{f['name']}** ({size_str})")

# --- Input history sidebar ---
with st.sidebar:
    st.subheader("Input History")
    st.caption("Press ↑/↓ in the input to navigate")
    if st.session_state.input_history:
        for i, entry in enumerate(reversed(st.session_state.input_history), 1):
            st.text(f"{i}. {entry}")
    else:
        st.caption("No history yet.")
