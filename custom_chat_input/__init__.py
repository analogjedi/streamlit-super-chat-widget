"""
Custom Chat Input component for Streamlit.

Features:
- Paste images directly from clipboard (Ctrl+V / Cmd+V)
- Navigate input history with Up/Down arrow keys
- Drag and drop image support
- Auto-resizing textarea
"""

import os
import base64
import streamlit.components.v1 as components
from typing import Optional, List, Dict, Any

# Determine if we're in development or production mode
_RELEASE = True  # Set to False during development with `npm start`

if not _RELEASE:
    _component_func = components.declare_component(
        "custom_chat_input",
        url="http://localhost:3001",
    )
else:
    _parent_dir = os.path.dirname(os.path.abspath(__file__))
    _build_dir = os.path.join(_parent_dir, "frontend", "build")
    _component_func = components.declare_component(
        "custom_chat_input",
        path=_build_dir,
    )


def custom_chat_input(
    placeholder: str = "Type a message...",
    key: Optional[str] = None,
    max_chars: int = 0,
    max_image_size_mb: int = 5,
    accepted_image_types: Optional[List[str]] = None,
    history: Optional[List[str]] = None,
    slash_commands: Optional[List[str]] = None,
    at_commands: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """
    A custom chat input widget with image paste and input history support.

    Parameters
    ----------
    placeholder : str
        Placeholder text shown when the input is empty.
    key : str or None
        An optional string to use as the unique key for the widget.
    max_chars : int
        Maximum number of characters allowed. 0 = unlimited.
    max_image_size_mb : int
        Maximum image file size in megabytes. Default 5MB.
    accepted_image_types : list of str or None
        List of accepted MIME types. Default: png, jpeg, gif, webp.
    history : list of str or None
        List of previous input entries for up-arrow navigation.
        Typically stored in st.session_state.
    slash_commands : list of str or None
        List of available commands for the '/' prefix autocomplete.
        When the user types '/' at the start of input, matching commands
        are shown in a popup. Commands should NOT include the '/' prefix.
    at_commands : list of str or None
        List of available commands for the '@' prefix autocomplete.
        When the user types '@' at the start of input, matching commands
        are shown in a popup. Commands should NOT include the '@' prefix.

    Returns
    -------
    dict or None
        Returns None if no submission yet.
        On submission, returns a dict with:
        - "text": str - the text content
        - "images": list of dict - each with "name", "type", "data" (base64), "size"
        - "history": list of str - updated history
    """
    if accepted_image_types is None:
        accepted_image_types = ["image/png", "image/jpeg", "image/gif", "image/webp"]

    if history is None:
        history = []

    result = _component_func(
        placeholder=placeholder,
        max_chars=max_chars,
        max_image_size_mb=max_image_size_mb,
        accepted_image_types=accepted_image_types,
        history=history,
        slash_commands=slash_commands or [],
        at_commands=at_commands or [],
        key=key,
        default=None,
    )

    return result


def decode_image(image_data: Dict[str, Any]) -> bytes:
    """
    Decode a base64 image attachment from the component result.

    Parameters
    ----------
    image_data : dict
        An image dict from the component result containing "data" (base64 string).

    Returns
    -------
    bytes
        The decoded image bytes.
    """
    return base64.b64decode(image_data["data"])
