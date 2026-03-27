import React, { useEffect, useRef, useState, useCallback } from "react"
import {
  Streamlit,
  withStreamlitConnection,
  ComponentProps,
} from "streamlit-component-lib"

/**
 * Custom Chat Input component for Streamlit.
 *
 * Features:
 * 1. Image paste support - paste images from clipboard directly into the input
 * 2. Input history - press Up/Down arrows to navigate previous entries
 * 3. Auto-resizing textarea
 * 4. File attachment indicators
 */

interface FileAttachment {
  name: string
  type: string
  data: string // base64 encoded
  size: number
  is_image: boolean
}

// Keep backward-compat alias
type ImageAttachment = FileAttachment

const CustomChatInput: React.FC<ComponentProps> = ({ args, disabled, theme }) => {
  const [text, setText] = useState<string>("")
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number>(-1)
  const [draftText, setDraftText] = useState<string>("")
  const [isFocused, setIsFocused] = useState<boolean>(false)
  const [isDragOver, setIsDragOver] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [popupVisible, setPopupVisible] = useState<boolean>(false)
  const [popupType, setPopupType] = useState<"/" | "@" | null>(null)
  const [filteredCommands, setFilteredCommands] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const skipNextArgsRef = useRef<boolean>(false)
  const submitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const placeholder = args["placeholder"] || "Type a message..."
  const maxChars = args["max_chars"] || 0
  const maxImageSize = args["max_image_size_mb"] || 5
  const acceptedTypes = args["accepted_image_types"] || ["image/png", "image/jpeg", "image/gif", "image/webp"]
  const slashCommands: string[] = args["slash_commands"] || []
  const atCommands: string[] = args["at_commands"] || []

  // Restore history from args (Python side persists it in session_state)
  useEffect(() => {
    if (args["history"] && Array.isArray(args["history"])) {
      setHistory(args["history"])
    }
    // After submit, the first args change is from the rerun we triggered —
    // skip it so the overlay stays visible during processing. Clear on
    // the second args change (the app's st.rerun() after processing).
    if (skipNextArgsRef.current) {
      skipNextArgsRef.current = false
      return
    }
    setIsSubmitting(false)
    if (submitTimeoutRef.current) {
      clearTimeout(submitTimeoutRef.current)
      submitTimeoutRef.current = null
    }
  }, [args])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      const scrollHeight = textareaRef.current.scrollHeight
      textareaRef.current.style.height = Math.min(scrollHeight, 200) + "px"
    }
  }, [text])

  // Autocomplete popup logic
  useEffect(() => {
    if (text.startsWith("/") && slashCommands.length > 0) {
      const query = text.slice(1).toLowerCase()
      if (!/\s/.test(query)) {
        const matches = query.length === 0
          ? slashCommands
          : slashCommands.filter(cmd => cmd.toLowerCase().includes(query))
        if (matches.length > 0) {
          setFilteredCommands(matches)
          setPopupVisible(true)
          setPopupType("/")
          setSelectedIndex(0)
          return
        }
      }
    }

    if (text.startsWith("@") && atCommands.length > 0) {
      const query = text.slice(1).toLowerCase()
      if (!/\s/.test(query)) {
        const matches = query.length === 0
          ? atCommands
          : atCommands.filter(cmd => cmd.toLowerCase().includes(query))
        if (matches.length > 0) {
          setFilteredCommands(matches)
          setPopupVisible(true)
          setPopupType("@")
          setSelectedIndex(0)
          return
        }
      }
    }

    setPopupVisible(false)
    setPopupType(null)
    setFilteredCommands([])
    setSelectedIndex(0)
  }, [text, slashCommands, atCommands])

  // Scroll selected popup item into view
  useEffect(() => {
    if (popupVisible && popupRef.current) {
      const selectedEl = popupRef.current.children[selectedIndex] as HTMLElement
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest" })
      }
    }
  }, [selectedIndex, popupVisible])

  // Set frame height dynamically
  useEffect(() => {
    const baseHeight = 70
    const imagePreviewHeight = images.length > 0 ? 84 : 0
    const textLines = (text.match(/\n/g) || []).length
    const extraTextHeight = Math.min(textLines * 20, 144)
    const popupHeight = popupVisible && filteredCommands.length > 0
      ? Math.min(filteredCommands.length * 36, 200) + 8
      : 0
    const loadingHeight = isLoading ? 36 : 0
    Streamlit.setFrameHeight(baseHeight + imagePreviewHeight + extraTextHeight + popupHeight + loadingHeight)
  }, [text, images, popupVisible, filteredCommands, isLoading])

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        // Strip the data URL prefix to get pure base64
        const base64 = result.split(",")[1]
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const processFiles = useCallback(
    async (files: File[], imagesOnly: boolean = false) => {
      const validFiles = files.filter((f) => {
        if (imagesOnly && !f.type.startsWith("image/")) {
          return false
        }
        if (f.size > maxImageSize * 1024 * 1024) {
          console.warn(`File too large: ${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB)`)
          return false
        }
        return true
      })

      if (validFiles.length === 0) return

      setIsLoading(true)
      // Yield to renderer so the loading indicator paints before processing
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      try {
        const newAttachments: FileAttachment[] = []
        for (const file of validFiles) {
          const base64 = await fileToBase64(file)
          newAttachments.push({
            name: file.name || (file.type.startsWith("image/") ? `pasted-image-${Date.now()}.png` : `file-${Date.now()}`),
            type: file.type,
            data: base64,
            size: file.size,
            is_image: file.type.startsWith("image/"),
          })
        }

        if (newAttachments.length > 0) {
          setImages((prev) => [...prev, ...newAttachments])
        }
      } finally {
        setIsLoading(false)
      }
    },
    [maxImageSize]
  )

  // Select a command from the autocomplete popup
  const selectCommand = useCallback((command: string) => {
    const prefix = popupType || "/"
    setText(prefix + command + " ")
    setPopupVisible(false)
    setPopupType(null)
    setFilteredCommands([])
    setSelectedIndex(0)
    textareaRef.current?.focus()
  }, [popupType])

  // Handle paste event - intercept images from clipboard
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardItems = Array.from(e.clipboardData?.items || [])
      const imageItems = clipboardItems.filter(
        (item) => item.kind === "file" && item.type.startsWith("image/")
      )

      if (imageItems.length > 0) {
        e.preventDefault()
        const files = imageItems
          .map((item) => item.getAsFile())
          .filter((f): f is File => f !== null)
        processFiles(files, true)
      }
      // If no images, let default text paste happen
    },
    [processFiles]
  )

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        processFiles(files, false)
      }
    },
    [processFiles]
  )

  // Submit message
  const handleSubmit = useCallback(async () => {
    const trimmedText = text.trim()
    if (!trimmedText && images.length === 0) return

    // Show submitting overlay only for large payloads (>1MB) where transfer
    // takes long enough to need visual feedback
    const totalFileSize = images.reduce((sum, f) => sum + f.size, 0)
    if (totalFileSize > 1 * 1024 * 1024) {
      setIsSubmitting(true)
      skipNextArgsRef.current = true
      // Safety fallback: clear overlay after 2 minutes even if no second rerun arrives
      if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current)
      submitTimeoutRef.current = setTimeout(() => setIsSubmitting(false), 120000)
      // Yield to renderer so the overlay paints before setComponentValue
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    }

    // Add to history
    if (trimmedText) {
      setHistory((prev) => {
        const newHistory = [...prev.filter((h) => h !== trimmedText), trimmedText]
        // Keep last 50 entries
        return newHistory.slice(-50)
      })
    }

    // Send value to Streamlit
    Streamlit.setComponentValue({
      text: trimmedText,
      images: images,
      history: history,
    })

    // Reset state
    setText("")
    setImages([])
    setHistoryIndex(-1)
    setDraftText("")
  }, [text, images, history])

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Autocomplete popup keyboard handling (takes priority)
      if (popupVisible && filteredCommands.length > 0) {
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setSelectedIndex(prev =>
            prev <= 0 ? filteredCommands.length - 1 : prev - 1
          )
          return
        }
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setSelectedIndex(prev =>
            prev >= filteredCommands.length - 1 ? 0 : prev + 1
          )
          return
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault()
          selectCommand(filteredCommands[selectedIndex])
          return
        }
        if (e.key === "Tab") {
          e.preventDefault()
          selectCommand(filteredCommands[selectedIndex])
          return
        }
        if (e.key === "Escape") {
          e.preventDefault()
          setPopupVisible(false)
          return
        }
      }

      // Submit on Enter (without Shift)
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
        return
      }

      // Navigate history with Up arrow
      if (e.key === "ArrowUp") {
        const cursorPos = textareaRef.current?.selectionStart || 0
        const isAtStart = cursorPos === 0

        if (isAtStart && history.length > 0) {
          e.preventDefault()

          if (historyIndex === -1) {
            // Save current draft before navigating history
            setDraftText(text)
          }

          const newIndex =
            historyIndex === -1
              ? history.length - 1
              : Math.max(0, historyIndex - 1)

          setHistoryIndex(newIndex)
          setText(history[newIndex])
        }
      }

      // Navigate history with Down arrow
      if (e.key === "ArrowDown") {
        const cursorPos = textareaRef.current?.selectionStart || 0
        const textLength = text.length
        const isAtEnd = cursorPos === textLength

        if (isAtEnd && historyIndex !== -1) {
          e.preventDefault()

          if (historyIndex >= history.length - 1) {
            // Return to draft
            setHistoryIndex(-1)
            setText(draftText)
          } else {
            const newIndex = historyIndex + 1
            setHistoryIndex(newIndex)
            setText(history[newIndex])
          }
        }
      }
    },
    [handleSubmit, history, historyIndex, text, draftText, popupVisible, filteredCommands, selectedIndex, selectCommand]
  )

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let newText = e.target.value
    if (maxChars > 0 && newText.length > maxChars) {
      newText = newText.slice(0, maxChars)
    }
    setText(newText)
    // Reset history navigation when user types
    if (historyIndex !== -1) {
      setHistoryIndex(-1)
    }
  }

  // File upload button handler
  const handleFileButtonClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      processFiles(files, false)
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  // ---- Styles ----
  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    fontFamily: theme?.font || "sans-serif",
    fontSize: "14px",
  }

  const inputWrapperStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-end",
    border: `1px solid ${isDragOver ? (theme?.primaryColor || "#ff4b4b") : isFocused ? (theme?.primaryColor || "#ff4b4b") : "#e0e0e0"}`,
    borderRadius: "12px",
    padding: "8px 12px",
    backgroundColor: theme?.secondaryBackgroundColor || "#f8f9fa",
    transition: "border-color 0.2s, box-shadow 0.2s",
    boxShadow: isFocused ? `0 0 0 1px ${theme?.primaryColor || "#ff4b4b"}` : "none",
    position: "relative",
  }

  const textareaStyle: React.CSSProperties = {
    flex: 1,
    border: "none",
    outline: "none",
    resize: "none",
    backgroundColor: "transparent",
    color: theme?.textColor || "#333",
    fontSize: "14px",
    lineHeight: "20px",
    fontFamily: "inherit",
    padding: "4px 0",
    minHeight: "24px",
    maxHeight: "200px",
    overflow: "auto",
  }

  const sendButtonStyle: React.CSSProperties = {
    background: text.trim() || images.length > 0
      ? (theme?.primaryColor || "#ff4b4b")
      : "#ccc",
    border: "none",
    borderRadius: "8px",
    color: "white",
    cursor: text.trim() || images.length > 0 ? "pointer" : "default",
    padding: "6px 10px",
    marginLeft: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "background 0.2s",
    height: "32px",
    width: "32px",
  }

  const imagePreviewContainerStyle: React.CSSProperties = {
    display: "flex",
    gap: "8px",
    padding: "8px 4px 4px 4px",
    overflowX: "auto",
    flexWrap: "nowrap",
  }

  const imagePreviewStyle: React.CSSProperties = {
    position: "relative",
    width: "60px",
    height: "60px",
    borderRadius: "8px",
    overflow: "hidden",
    flexShrink: 0,
    border: "1px solid #e0e0e0",
  }

  const removeButtonStyle: React.CSSProperties = {
    position: "absolute",
    top: "2px",
    right: "2px",
    background: "rgba(0,0,0,0.6)",
    color: "white",
    border: "none",
    borderRadius: "50%",
    width: "18px",
    height: "18px",
    fontSize: "12px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
    padding: 0,
  }

  const dragOverlayStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    background: `${theme?.primaryColor || "#ff4b4b"}22`,
    borderRadius: "12px",
    display: isDragOver ? "flex" : "none",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    zIndex: 10,
    color: theme?.primaryColor || "#ff4b4b",
    fontWeight: 600,
    fontSize: "13px",
  }

  const attachButtonStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    borderRadius: "8px",
    color: theme?.textColor || "#666",
    cursor: "pointer",
    padding: "4px",
    marginRight: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    height: "32px",
    width: "32px",
    transition: "background 0.15s, color 0.15s",
    opacity: 0.6,
  }

  const charCountStyle: React.CSSProperties = {
    fontSize: "11px",
    color: maxChars > 0 && text.length > maxChars * 0.9 ? "#ff4b4b" : "#999",
    textAlign: "right",
    padding: "2px 4px 0 0",
  }

  const popupContainerStyle: React.CSSProperties = {
    backgroundColor: theme?.backgroundColor || "#ffffff",
    border: `1px solid ${theme?.primaryColor || "#ff4b4b"}44`,
    borderRadius: "8px",
    boxShadow: "0 -2px 8px rgba(0, 0, 0, 0.08)",
    maxHeight: "200px",
    overflowY: "auto",
    marginBottom: "4px",
  }

  const popupItemStyle: React.CSSProperties = {
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: "14px",
    color: theme?.textColor || "#333",
    transition: "background-color 0.1s",
    display: "flex",
    alignItems: "center",
    gap: "4px",
  }

  const popupPrefixStyle: React.CSSProperties = {
    color: theme?.primaryColor || "#ff4b4b",
    fontWeight: 600,
    opacity: 0.7,
  }

  return (
    <div style={containerStyle}>
      {/* Autocomplete popup */}
      {popupVisible && filteredCommands.length > 0 && (
        <div ref={popupRef} style={popupContainerStyle}>
          {filteredCommands.map((cmd, idx) => (
            <div
              key={cmd}
              style={{
                ...popupItemStyle,
                backgroundColor: idx === selectedIndex
                  ? (theme?.primaryColor || "#ff4b4b") + "22"
                  : "transparent",
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                selectCommand(cmd)
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <span style={popupPrefixStyle}>{popupType}</span>
              {cmd}
            </div>
          ))}
        </div>
      )}

      {/* Loading indicator (file conversion) */}
      {isLoading && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          fontSize: "13px",
          color: theme?.textColor || "#666",
          opacity: 0.8,
          animation: "pulse 1.5s ease-in-out infinite",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme?.primaryColor || "#ff4b4b"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
          Preparing files...
          <style>{`
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            @keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
          `}</style>
        </div>
      )}

      {/* File/image previews */}
      {images.length > 0 && (
        <div style={imagePreviewContainerStyle}>
          {images.map((file, idx) => (
            <div key={idx} style={imagePreviewStyle}>
              {file.is_image ? (
                <img
                  src={`data:${file.type};base64,${file.data}`}
                  alt={file.name}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme?.secondaryBackgroundColor || "#f0f0f0",
                    padding: "4px",
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={theme?.textColor || "#666"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span style={{ fontSize: "8px", color: theme?.textColor || "#666", marginTop: "2px", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", width: "100%", whiteSpace: "nowrap" }}>
                    {file.name.length > 10 ? file.name.slice(0, 8) + "…" : file.name}
                  </span>
                </div>
              )}
              <button
                style={removeButtonStyle}
                onClick={() => removeImage(idx)}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div
        style={inputWrapperStyle}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div style={dragOverlayStyle}>Drop images here</div>
        {/* Submit overlay — covers input area while sending */}
        {isSubmitting && (
          <div style={{
            position: "absolute",
            inset: 0,
            background: `${theme?.secondaryBackgroundColor || "#f8f9fa"}ee`,
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 10,
            gap: "8px",
            fontSize: "13px",
            color: theme?.textColor || "#666",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme?.primaryColor || "#ff4b4b"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            Sending...
            <style>{`
              @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
          </div>
        )}
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFileInputChange}
        />
        {/* Paperclip / attach button */}
        <button
          style={attachButtonStyle}
          onClick={handleFileButtonClick}
          disabled={disabled || isLoading || isSubmitting}
          title="Attach files"
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "1"
            e.currentTarget.style.background = theme?.secondaryBackgroundColor ? "rgba(0,0,0,0.05)" : "#eee"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "0.6"
            e.currentTarget.style.background = "none"
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          style={textareaStyle}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setIsFocused(false)
            setTimeout(() => setPopupVisible(false), 150)
          }}
          placeholder={placeholder}
          disabled={disabled || isLoading || isSubmitting}
          rows={1}
        />
        <button
          style={sendButtonStyle}
          onClick={handleSubmit}
          disabled={disabled || isLoading || isSubmitting || (!text.trim() && images.length === 0)}
          title="Send message (Enter)"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      {/* Character count */}
      {maxChars > 0 && (
        <div style={charCountStyle}>
          {text.length}/{maxChars}
        </div>
      )}
    </div>
  )
}

export default withStreamlitConnection(CustomChatInput)
