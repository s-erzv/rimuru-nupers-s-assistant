import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import Card from './ui/Card';
import FinanceList from './FinanceList';
import ScheduleList from './ScheduleList';

// Fungsi text-to-speech yang sudah di-update untuk suara bahasa Indonesia wanita
function speakText(text, onEndCallback) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Ambil semua suara yang tersedia
    const voices = window.speechSynthesis.getVoices();
    
    // Prioritaskan suara wanita berbahasa Indonesia (id-ID)
    let selectedVoice = voices.find(voice => voice.lang === 'id-ID' && (voice.name.includes('Wanita') || voice.name.includes('Perempuan') || voice.name.includes('Female')));
    
    // Jika tidak ada suara wanita, ambil saja suara berbahasa Indonesia yang pertama
    if (!selectedVoice) {
      selectedVoice = voices.find(voice => voice.lang === 'id-ID');
    }

    // Jika suara ditemukan, gunakan
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    
    utterance.lang = 'id-ID';
    utterance.rate = 1.1; 
    utterance.onend = onEndCallback;
    window.speechSynthesis.speak(utterance);
  } else {
    console.error('Browser ini tidak mendukung Web Speech API.');
  }
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export default function Chat({ API_BASE_URL, userToken, fetchWithAuth, registerForPush, isFirstLoad, setIsFirstLoad, setErrorMessage }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState(null);

  const recognitionRef = useRef(null);

  useEffect(() => {
    if (isFirstLoad) {
      const greetingMessage = {
        sender: 'gemini',
        text:
          "Halo! Aku Rimuru, asisten pribadimu dari **Nupers’s Assistant** 😎. Siap bantu hidupmu lebih teratur. Yuk, mulai dengan mengetik sesuatu!",
      };
      setMessages([greetingMessage]);
      setIsFirstLoad(false);
      registerForPush();
    }

    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = 'id-ID'; // Mengubah bahasa ke Bahasa Indonesia
      
      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };
      
      recognitionRef.current.onerror = (event) => {
        console.error('Error pengenalan suara:', event.error);
        setIsRecording(false);
        setErrorMessage(`Terjadi error pada pengenalan suara: ${event.error}`);
      };
    }
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };

  }, [isFirstLoad, setIsFirstLoad, registerForPush]);

  const toggleRecording = () => {
    if (!SpeechRecognition) {
      setErrorMessage("Maaf, browser Anda tidak mendukung fitur ini.");
      return;
    }
    
    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      setIsRecording(true);
      setErrorMessage('');
      recognitionRef.current.start();
    }
  };

  const handleToggleSpeech = (text, id) => {
    if (speakingMessageId === id) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
    } else {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(id);
      speakText(text, () => setSpeakingMessageId(null));
    }
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const messageToSend = input.trim();
    if (!messageToSend || isLoading) return;

    const newMessage = { sender: 'user', text: messageToSend };
    setMessages((prev) => [...prev, newMessage, { sender: 'gemini', text: 'Memproses…', isLoading: true }]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetchWithAuth('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newMessage.text }),
      });
      if (!res.ok) throw new Error('Gagal mengirim pesan.');
      const data = await res.json();
      
      setMessages((prev) => {
        const withoutLoading = prev.filter((m) => !m.isLoading);
        const newResponse = { sender: 'gemini', text: data.text };
        if (data.dataType === 'finances' || data.dataType === 'schedules') {
          newResponse.dataType = data.dataType;
          newResponse.data = data.data;
        }
        return [...withoutLoading, newResponse];
      });
      setErrorMessage('');
    } catch (err) {
      console.error(err);
      setMessages((prev) => prev.filter((m) => !m.isLoading));
      setErrorMessage('Terjadi kesalahan saat mengirim pesan. Silakan coba lagi.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.dataType === 'finances' ? (
              <div className="w-full">
                <ReactMarkdown
                  components={{
                    p: ({ node, ...props }) => <p className="whitespace-pre-line text-sm leading-relaxed mb-2" {...props} />,
                    ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-2" {...props} />,
                    li: ({ node, ...props }) => <li className="mb-1" {...props} />,
                    strong: ({ node, ...props }) => <strong className="font-bold" {...props} />,
                    em: ({ node, ...props }) => <em className="italic" {...props} />,
                  }}
                >
                  {m.text}
                </ReactMarkdown>
                <FinanceList finances={m.data} />
              </div>
            ) : m.dataType === 'schedules' ? (
              <div className="w-full">
                <ReactMarkdown
                  components={{
                    p: ({ node, ...props }) => <p className="whitespace-pre-line text-sm leading-relaxed mb-2" {...props} />,
                    ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-2" {...props} />,
                    li: ({ node, ...props }) => <li className="mb-1" {...props} />,
                    strong: ({ node, ...props }) => <strong className="font-bold" {...props} />,
                    em: ({ node, ...props }) => <em className="italic" {...props} />,
                  }}
                >
                  {m.text}
                </ReactMarkdown>
                <ScheduleList schedules={m.data} />
              </div>
            ) : (
              <div
                className={`max-w-md rounded-xl border ${
                  m.sender === 'user'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-900 border-slate-200'
                } p-3 shadow-md`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <ReactMarkdown
                      components={{
                        p: ({ node, ...props }) => <p className="whitespace-pre-line text-sm leading-relaxed" {...props} />,
                        strong: ({ node, ...props }) => <strong className="font-bold" {...props} />,
                        em: ({ node, ...props }) => <em className="italic" {...props} />,
                      }}
                    >
                      {m.text}
                    </ReactMarkdown>
                  </div>
                  {m.sender === 'gemini' && m.text && (
                    <button 
                      onClick={() => handleToggleSpeech(m.text, i)}
                      className={`flex-shrink-0 transition-colors ${speakingMessageId === i ? 'text-blue-500' : 'text-slate-400 hover:text-slate-600'}`}
                      aria-label="Dengarkan pesan"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {speakingMessageId === i ? (
                          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                        ) : (
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                        )}
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="w-full sticky bottom-0 z-10 bg-white border-t border-slate-200 pt-3 pb-2">
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isRecording ? 'Mendengarkan...' : 'Ketik pesan…'}
            className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            disabled={isRecording}
          />
          <button
            type="button"
            onClick={toggleRecording}
            className={`h-10 w-10 flex items-center justify-center rounded-full transition-colors ${isRecording ? 'bg-rose-500 hover:bg-rose-600 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </button>
          <button
            type="submit"
            disabled={isLoading || isRecording}
            className={`h-10 w-10 flex items-center justify-center rounded-full text-white transition-colors ${isLoading || isRecording ? 'bg-slate-500' : 'bg-slate-900 hover:bg-black'}`}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-7-7l7 7-7 7" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}