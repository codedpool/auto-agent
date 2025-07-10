
import React, { useState, useEffect } from 'react';
import { Send, MessageCircle, Sparkles, FileText, Search, Check, X } from 'lucide-react';
import Groq from 'groq-sdk';
import ApiKeyModal from './ApiKeyModal';

interface Message {
  id: number;
  text: string;
  isUser: boolean;
  timestamp: Date;
  context?: string;
  actionPlan?: ActionPlan; // Add action plan to message for confirmation
}

interface IndexEntry {
  id: string;
  content: string;
  keywords: string[];
  timestamp: Date;
  relevanceScore?: number;
}

interface ActionPlanStep {
  step: number;
  description: string;
  application?: string;
  actionType?: 'click' | 'type' | 'navigate' | 'wait';
  target?: string;
}

interface ActionPlan {
  task: string;
  steps: ActionPlanStep[];
}

const Chat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      text: "Welcome to the Autonomous Desktop Agent! I can help you with document analysis, index parsing, and intelligent information retrieval. How can I assist you today?",
      isUser: false,
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [documentIndex, setDocumentIndex] = useState<IndexEntry[]>([]);
  const [isIndexing, setIsIndexing] = useState(false);
  const [actionPlan, setActionPlan] = useState<ActionPlan | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<number | null>(null); // Track message ID awaiting confirmation

  useEffect(() => {
    const loadApiKey = async () => {
      try {
        if (window.__TAURI__) {
          const { readTextFile } = await import('@tauri-apps/plugin-fs');
          const { appDataDir } = await import('@tauri-apps/api/path');
          const appDirPath = await appDataDir();
          const envPath = `${appDirPath}/.env`;
          const envContent = await readTextFile(envPath);
          const match = envContent.match(/VITE_GROQ_API_KEY=(.*)/);
          if (match?.[1]) {
            setApiKey(match[1].trim());
          } else {
            setShowModal(true);
          }
        } else {
          const storedKey = localStorage.getItem('GROQ_API_KEY');
          if (storedKey) {
            setApiKey(storedKey);
          } else {
            setShowModal(true);
          }
        }
      } catch (error) {
        console.error('Failed to load API key:', error);
        setShowModal(true);
      }
    };
    loadApiKey();
  }, []);

  // Enhanced context system with intent parsing
  const buildEnhancedContext = async (userQuery: string): Promise<string> => {
    const relevantEntries = findRelevantIndexEntries(userQuery);

    let context = `You are the Autonomous Desktop Agent (ADA) — an advanced system designed to take natural language commands, parse intent, and autonomously execute multi-step tasks on Windows Virtual Desktops through native UI automation and screen parsing.

🧠 CORE CAPABILITIES:
1. Natural Language Understanding & Intent Parsing
2. Multi-Step Task Planning & Intent Confirmation
3. Screen-Aware Operations via Visual Indexing (Screenpipe + OCR)
4. Full Native UI Automation (via Terminator)
5. Seamless Virtual Desktop Switching
6. Background Execution Without APIs
7. Indexed Memory for Contextual Retrieval
8. Intelligent Feedback & Result Confirmation
9. Never ask user to log in or provide credentials
10. Always assume user is logged in to all applications
11. After opening browser first search for the website, always type the url directly in the address bar
12. Use the most relevant application for the task (e.g., Microsoft Edge for web tasks, Notepad for text editing)


⚙️ EXECUTION WORKFLOW:
1. Input --> User command received
2. Intent Parsing --> Understand & build an execution plan
3. Confirmation --> Confirm with the user
4. Desktop Switching --> Switch to virtual desktop
5. Automation Setup --> Open required applications
6. Screen Parsing --> Visually index screen using OCR
7. Execution --> Perform actions via UI automation
8. Feedback Loop --> Monitor for success/failure
9. Result --> Report outcome to user

📂 INDEX STATUS:
- Total Indexed Entries: ${documentIndex.length}
- Retrieval Mode: Enhanced Semantic Lookup
- Matching Algorithm: Keyword/Entity/Theme Overlap
- Relevance Threshold: High

`;

    if (relevantEntries.length > 0) {
      context += `📌 RELEVANT INDEXED CONTENT:
${relevantEntries
  .map(
    (entry) =>
      `• [${entry.id}] ${entry.content.substring(0, 200)}... (Keywords: ${entry.keywords.join(', ')})`,
  )
  .join('\n')}

`;
    }

    context += `📎 INTENT PARSING INSTRUCTION:
- Analyze the user's query to identify the intended task.
- Generate a structured JSON action plan with the following format:
{
  "task": "Summary of the task in one sentence",
  "steps": [
    {
      "step": 1,
      "description": "Detailed description of the step",
      "application": "Name of the application (e.g., Microsoft Edge, Notepad)",
      "actionType": "click | type | navigate | wait",
      "target": "UI element or URL to interact with (e.g., button, text field, URL)"
    },
    ...
  ]
}
- Ensure the JSON is valid and properly formatted. Wrap the response in triple backticks (\`\`\`json\\n...\\n\`\`\`).
- For each step, specify the application, actionType, and target if applicable.
- If the query is not a task (e.g., a question or request for information), return an empty action plan: { "task": "", "steps": [] }.
- Handle specific commands like "Post a tweet about AI agents through Microsoft Edge" by including the tweet content in the 'type' action step.
- Do not execute the task; only generate the plan.

🗣 USER QUERY:
${userQuery}

Return only the JSON action plan wrapped in triple backticks (\`\`\`json\\n...\\n\`\`\`).`;

    return context;
  };

  // Index parsing and content analysis (unchanged)
  const parseAndIndexContent = async (content: string, source: string = 'user_input'): Promise<void> => {
    setIsIndexing(true);
    try {
      if (!apiKey) return;
      const groq = new Groq({
        apiKey,
        dangerouslyAllowBrowser: true,
      });
      const analysisPrompt = `Analyze the following content and extract:
1. Key concepts and topics (max 10 keywords)
2. Main themes or subjects
3. Important entities (people, places, organizations, etc.)
4. Content summary (2-3 sentences)

Content to analyze:
${content}

Respond in JSON format:
{
  "keywords": ["keyword1", "keyword2", ...],
  "themes": ["theme1", "theme2", ...],
  "entities": ["entity1", "entity2", ...],
  "summary": "Brief summary of the content"
}`;
      const analysisResponse = await groq.chat.completions.create({
        messages: [{ role: 'user', content: analysisPrompt }],
        model: 'llama3-8b-8192',
        temperature: 0.3,
        max_tokens: 1024,
      });
      const analysisText = analysisResponse.choices[0]?.message?.content || '';
      try {
        const analysis = JSON.parse(analysisText);
        const newEntry: IndexEntry = {
          id: `idx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          content: content,
          keywords: [...(analysis.keywords || []), ...(analysis.themes || []), ...(analysis.entities || [])],
          timestamp: new Date(),
        };
        setDocumentIndex((prev) => [...prev, newEntry]);
        const indexMessage: Message = {
          id: Date.now(),
          text: `📋 Content indexed successfully! Added ${newEntry.keywords.length} keywords and concepts to the knowledge base. Summary: ${analysis.summary || 'Content processed and indexed.'}`,
          isUser: false,
          timestamp: new Date(),
          context: 'system_indexing',
        };
        setMessages((prev) => [...prev, indexMessage]);
      } catch (parseError) {
        console.error('Failed to parse analysis response:', parseError);
        const basicEntry: IndexEntry = {
          id: `idx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          content: content,
          keywords: extractBasicKeywords(content),
          timestamp: new Date(),
        };
        setDocumentIndex((prev) => [...prev, basicEntry]);
      }
    } catch (error) {
      console.error('Index parsing error:', error);
    } finally {
      setIsIndexing(false);
    }
  };

  // Basic keyword extraction fallback (unchanged)
  const extractBasicKeywords = (text: string): string[] => {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3);
    const wordFreq: { [key: string]: number } = {};
    words.forEach((word) => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
    return Object.entries(wordFreq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([word]) => word);
  };

  // Find relevant index entries based on query (unchanged)
  const findRelevantIndexEntries = (query: string): IndexEntry[] => {
    const queryWords = query.toLowerCase().split(/\s+/);
    return documentIndex
      .map((entry) => {
        const relevanceScore = entry.keywords.reduce((score, keyword) => {
          return (
            score +
            queryWords.filter(
              (word) =>
                keyword.toLowerCase().includes(word) ||
                word.includes(keyword.toLowerCase()),
            ).length
          );
        }, 0);
        return { ...entry, relevanceScore };
      })
      .filter((entry) => entry.relevanceScore! > 0)
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, 5);
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !apiKey) return;

    const newMessage: Message = {
      id: messages.length + 1,
      text: inputValue,
      isUser: true,
      timestamp: new Date(),
    };
    setMessages([...messages, newMessage]);

    if (
      inputValue.toLowerCase().includes('index this:') ||
      inputValue.toLowerCase().includes('analyze this:')
    ) {
      const contentToIndex = inputValue
        .replace(/^(index this:|analyze this:)/i, '')
        .trim();
      if (contentToIndex) {
        await parseAndIndexContent(contentToIndex);
      }
      setInputValue('');
      return;
    }

    try {
      const groq = new Groq({
        apiKey,
        dangerouslyAllowBrowser: true,
      });

      const enhancedContext = await buildEnhancedContext(inputValue);

      const chatCompletion = await groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: enhancedContext,
          },
          {
            role: 'user',
            content: inputValue,
          },
        ],
        model: 'llama3-8b-8192',
        temperature: 0.3, // Lowered temperature for more consistent JSON
        max_tokens: 1024,
        top_p: 0.9,
        stream: false,
      });

      const aiResponseText = chatCompletion.choices[0]?.message?.content || '';
      let actionPlan: ActionPlan = { task: '', steps: [] };

      try {
        // Extract JSON from triple backticks
        const jsonMatch = aiResponseText.match(/```json\n([\s\S]*?)\n```/);
        if (!jsonMatch?.[1]) {
          throw new Error('No valid JSON found in response');
        }
        actionPlan = JSON.parse(jsonMatch[1]);
      } catch (error) {
        console.error('Failed to parse action plan:', error, 'Response:', aiResponseText);
        const errorMessage: Message = {
          id: messages.length + 2,
          text: 'Error parsing the action plan. Please try rephrasing your command or simplifying it (e.g., "Post a tweet about AI").',
          isUser: false,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
        setInputValue('');
        return;
      }

      setActionPlan(actionPlan);

      if (actionPlan.steps.length > 0) {
        // Display action plan and await confirmation
        const planMessage: Message = {
          id: messages.length + 2,
          text: `Generated Action Plan:\nTask: ${actionPlan.task}\nSteps:\n${actionPlan.steps
            .map((step) => `- Step ${step.step}: ${step.description}`)
            .join('\n')}\n\nPlease confirm to proceed with this plan.`,
          isUser: false,
          timestamp: new Date(),
          context: 'action_plan',
          actionPlan, // Store action plan in message for confirmation
        };
        setMessages((prev) => [...prev, planMessage]);
        setAwaitingConfirmation(planMessage.id); // Set message ID for confirmation
      } else {
        // Handle non-task queries (informational responses)
        const infoMessage: Message = {
          id: messages.length + 2,
          text: 'This query does not appear to be a task requiring automation. Please provide a specific task or ask for information.',
          isUser: false,
          timestamp: new Date(),
          context: 'info',
        };
        setMessages((prev) => [...prev, infoMessage]);
      }

    } catch (error) {
      console.error('Groq API error:', error);
      const errorMessage: Message = {
        id: messages.length + 2,
        text: 'Error communicating with the AI system. Please check your API key or try again.',
        isUser: false,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    }

    setInputValue('');
  };

  const handleConfirmAction = (messageId: number) => {
    const message = messages.find((msg) => msg.id === messageId);
    if (!message?.actionPlan) return;

    setAwaitingConfirmation(null);
    const confirmMessage: Message = {
      id: messages.length + 1,
      text: `Action plan confirmed! Preparing to execute task: ${message.actionPlan.task}`,
      isUser: false,
      timestamp: new Date(),
      context: 'confirmation',
    };
    setMessages((prev) => [...prev, confirmMessage]);

    // TODO: Implement execution logic in the next step
  };

  const handleCancelAction = (messageId: number) => {
    setAwaitingConfirmation(null);
    setActionPlan(null);
    const cancelMessage: Message = {
      id: messages.length + 1,
      text: 'Action plan cancelled. Please provide a new command or modify the previous one.',
      isUser: false,
      timestamp: new Date(),
      context: 'cancellation',
    };
    setMessages((prev) => [...prev, cancelMessage]);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleApiKeySave = (key: string) => {
    setApiKey(key);
    setShowModal(false);
  };

  const clearIndex = () => {
    setDocumentIndex([]);
    const clearMessage: Message = {
      id: Date.now(),
      text: '🗑️ Document index cleared. All indexed content has been removed from the knowledge base.',
      isUser: false,
      timestamp: new Date(),
      context: 'system_clear',
    };
    setMessages((prev) => [...prev, clearMessage]);
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-black">
      {showModal && <ApiKeyModal onSave={handleApiKeySave} />}
      <div className="absolute inset-0 bg-black">
        <div className="absolute inset-0 opacity-40">
          {[...Array(30)].map((_, i) => (
            <div
              key={i}
              className="absolute w-0.5 h-0.5 bg-white rounded-full animate-pulse"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 3}s`,
                animationDuration: `${3 + Math.random() * 2}s`,
              }}
            />
          ))}
        </div>
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl animate-pulse" />
        <div
          className="absolute bottom-1/3 right-1/4 w-80 h-80 bg-purple-500/5 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: '2s' }}
        />
      </div>
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen p-4">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <Sparkles className="w-8 h-8 text-blue-400 mr-3" />
            <h1 className="text-3xl md:text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Autonomous Desktop Agent
            </h1>
            <Sparkles className="w-8 h-8 text-purple-400 ml-3" />
          </div>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Advanced AI with document analysis, index parsing, and intelligent information retrieval
          </p>
        </div>
        <div className="w-full max-w-4xl mx-auto">
          <div className="bg-gray-900/30 backdrop-blur-xl border border-gray-800 rounded-xl p-3 mb-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center">
                <FileText className="w-4 h-4 text-blue-400 mr-2" />
                <span className="text-sm text-gray-300">
                  Index: {documentIndex.length} entries
                </span>
              </div>
              {isIndexing && (
                <div className="flex items-center">
                  <div className="w-2 h-2 bg-yellow-400 rounded-full mr-2 animate-pulse" />
                  <span className="text-sm text-yellow-400">Processing...</span>
                </div>
              )}
            </div>
            {documentIndex.length > 0 && (
              <button
                onClick={clearIndex}
                className="text-xs text-gray-500 hover:text-red-400 transition-colors"
              >
                Clear Index
              </button>
            )}
          </div>
          <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-gray-800/50 border-b border-gray-700 p-4">
              <div className="flex items-center">
                <MessageCircle className="w-6 h-6 text-blue-400 mr-3" />
                <span className="text-white font-semibold">Autonomous Agent</span>
                <div className="ml-auto flex items-center">
                  <div className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse" />
                  <span className="text-sm text-gray-400">Enhanced Mode</span>
                </div>
              </div>
            </div>
            <div className="h-96 overflow-y-auto p-6 space-y-4 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-3 rounded-2xl ${
                      message.isUser
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white ml-4'
                        : message.context === 'system_indexing' || message.context === 'system_clear'
                        ? 'bg-gradient-to-r from-green-600/20 to-blue-600/20 backdrop-blur-sm border border-green-500/30 text-green-100 mr-4'
                        : message.context === 'action_plan'
                        ? 'bg-gradient-to-r from-yellow-600/20 to-blue-600/20 backdrop-blur-sm border border-yellow-500/30 text-yellow-100 mr-4'
                        : message.context === 'confirmation' || message.context === 'cancellation'
                        ? 'bg-gradient-to-r from-teal-600/20 to-blue-600/20 backdrop-blur-sm border border-teal-500/30 text-teal-100 mr-4'
                        : message.context === 'enhanced_context'
                        ? 'bg-gradient-to-r from-purple-600/20 to-blue-600/20 backdrop-blur-sm border border-purple-500/30 text-white mr-4'
                        : 'bg-gray-800/70 backdrop-blur-sm border border-gray-700 text-white mr-4'
                    }`}
                  >
                    <p className="text-sm leading-relaxed">{message.text}</p>
                    {message.context === 'action_plan' && awaitingConfirmation === message.id && (
                      <div className="mt-2 flex space-x-2">
                        <button
                          onClick={() => handleConfirmAction(message.id)}
                          className="flex items-center bg-green-500/50 hover:bg-green-600/70 text-white px-3 py-1 rounded-lg transition-colors"
                        >
                          <Check className="w-4 h-4 mr-1" />
                          Confirm
                        </button>
                        <button
                          onClick={() => handleCancelAction(message.id)}
                          className="flex items-center bg-red-500/50 hover:bg-red-600/70 text-white px-3 py-1 rounded-lg transition-colors"
                        >
                          <X className="w-4 h-4 mr-1" />
                          Cancel
                        </button>
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs opacity-70">
                        {message.timestamp.toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {(message.context === 'enhanced_context' || message.context === 'action_plan') && (
                        <Search className="w-3 h-3 text-purple-400" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-700 p-4">
              <div className="flex items-end space-x-3">
                <div className="flex-1">
                  <textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Ask me anything, or type 'index this: [content]' to add to knowledge base..."
                    className="w-full bg-gray-800/50 border border-gray-600 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent resize-none backdrop-blur-sm transition-all duration-200"
                    rows={1}
                    style={{ minHeight: '44px', maxHeight: '120px' }}
                    disabled={awaitingConfirmation !== null} // Disable input while awaiting confirmation
                  />
                </div>
                <button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || !apiKey || awaitingConfirmation !== null}
                  className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white p-3 rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-blue-500/25 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-500 text-center">
                Press Enter to send • Shift + Enter for new line • Use "index this:" to add content to knowledge base
              </div>
            </div>
          </div>
        </div>
        <div className="mt-8 text-center">
          <p className="text-gray-500 text-sm">
            Autonomous Desktop Agent • Enhanced with Index Parsing & Document Analysis
          </p>
        </div>
      </div>
    </div>
  );
};

export default Chat;