import os
import requests
from typing import Dict, Any, Optional

class LLMProvider:
    @staticmethod
    def get_active_provider() -> str:
        """
        Returns the active AI provider based on environment variables.
        Tries to auto-detect based on available keys if AI_PROVIDER is not set.
        """
        provider = os.getenv("AI_PROVIDER", "").lower()
        if provider in ["gemini", "ollama", "deepseek", "openai"]:
            return provider
            
        # Auto-detect fallback
        if os.getenv("GEMINI_API_KEY"):
            return "gemini"
        elif os.getenv("DEEPSEEK_API_KEY"):
            return "deepseek"
        elif os.getenv("OPENAI_API_KEY"):
            return "openai"
            
        return "ollama"  # Default fallback to local Ollama

    @classmethod
    def check_status(cls) -> Dict[str, Any]:
        """
        Checks connection status of the active provider and returns status information.
        """
        provider = cls.get_active_provider()
        
        if provider == "gemini":
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                return {"status": "error", "provider": "gemini", "message": "GEMINI_API_KEY is not set"}
            try:
                from google import genai
                client = genai.Client(api_key=api_key)
                model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
                free_models = [
                    {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash"},
                    {"id": "gemini-2.5-flash-lite", "name": "Gemini 2.5 Flash Lite"},
                    {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash"},
                    {"id": "gemini-2.0-flash-lite", "name": "Gemini 2.0 Flash Lite"},
                    {"id": "gemini-3.5-flash", "name": "Gemini 3.5 Flash"},
                    {"id": "gemini-3.1-flash-lite", "name": "Gemini 3.1 Flash Lite"}
                ]
                return {"status": "connected", "provider": "gemini", "model": model_name, "models": free_models}
            except Exception as e:
                return {"status": "error", "provider": "gemini", "message": str(e)}
                
        elif provider == "ollama":
            url = os.getenv("OLLAMA_URL", "http://localhost:11434")
            try:
                # Query tags/models list
                response = requests.get(f"{url}/api/tags", timeout=3)
                if response.status_code == 200:
                    data = response.json()
                    models = [m["name"] for m in data.get("models", [])]
                    selected_model = os.getenv("OLLAMA_MODEL", "llama3.2")
                    return {
                        "status": "connected", 
                        "provider": "ollama", 
                        "url": url, 
                        "models": models,
                        "model": selected_model
                    }
                else:
                    return {"status": "error", "provider": "ollama", "message": f"Ollama returned status {response.status_code}"}
            except requests.exceptions.RequestException:
                return {
                    "status": "offline", 
                    "provider": "ollama", 
                    "message": f"Could not connect to Ollama at {url}. Make sure Ollama is running."
                }
                
        elif provider == "deepseek":
            api_key = os.getenv("DEEPSEEK_API_KEY")
            if not api_key:
                return {"status": "error", "provider": "deepseek", "message": "DEEPSEEK_API_KEY is not set"}
            model_name = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
            return {
                "status": "configured", 
                "provider": "deepseek", 
                "model": model_name,
                "models": [
                    {"id": "deepseek-chat", "name": "DeepSeek Chat"}
                ]
            }
            
        elif provider == "openai":
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                return {"status": "error", "provider": "openai", "message": "OPENAI_API_KEY is not set"}
            model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
            return {
                "status": "configured", 
                "provider": "openai", 
                "model": model_name,
                "models": [
                    {"id": "gpt-4o-mini", "name": "GPT-4o Mini"},
                    {"id": "gpt-4o", "name": "GPT-4o"}
                ]
            }
            
        return {"status": "unknown", "provider": provider}

    @classmethod
    def query_llm(cls, prompt: str, model_override: Optional[str] = None) -> str:
        """
        Queries the active LLM provider with the given prompt and returns the text response.
        """
        provider = cls.get_active_provider()
        
        if provider == "gemini":
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise ValueError("GEMINI_API_KEY is not configured in environment variables.")
                
            from google import genai
            import time
            
            client = genai.Client(api_key=api_key)
            primary_model = model_override or os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
            
            # Models to try in order of preference (fallback chain)
            models_to_try = [primary_model]
            fallbacks = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite"]
            for fb in fallbacks:
                if fb not in models_to_try:
                    models_to_try.append(fb)
            
            last_error = None
            for model_name in models_to_try:
                # Retry up to 3 times per model with exponential backoff
                for attempt in range(3):
                    try:
                        response = client.models.generate_content(
                            model=model_name,
                            contents=prompt
                        )
                        if not response.text:
                            raise Exception("Empty response received from Gemini API.")
                        return response.text
                    except Exception as e:
                        last_error = e
                        err_str = str(e)
                        if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                            # Rate limited - wait and retry, then try next model
                            wait_time = (attempt + 1) * 3  # 3s, 6s, 9s
                            print(f"[AI] Gemini rate limited on {model_name} (attempt {attempt+1}/3). Waiting {wait_time}s...")
                            time.sleep(wait_time)
                            continue
                        elif "404" in err_str or "NOT_FOUND" in err_str:
                            # Model not available, skip to next model immediately
                            print(f"[AI] Model {model_name} not found, trying next...")
                            break
                        else:
                            # Other error, raise immediately
                            raise
                else:
                    # All retries exhausted for this model, try next
                    print(f"[AI] All retries exhausted for {model_name}, trying next model...")
                    continue
            
            # If we get here, all models and retries failed
            raise Exception(f"All Gemini models exhausted. Last error: {last_error}")
            
        elif provider == "ollama":
            url = os.getenv("OLLAMA_URL", "http://localhost:11434")
            model_name = model_override or os.getenv("OLLAMA_MODEL", "llama3.2")
            
            payload = {
                "model": model_name,
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "stream": False
            }
            try:
                response = requests.post(f"{url}/api/chat", json=payload, timeout=90)
                response.raise_for_status()
                data = response.json()
                return data["message"]["content"]
            except Exception as e:
                raise Exception(f"Ollama query failed: {str(e)}")
                
        elif provider == "deepseek":
            api_key = os.getenv("DEEPSEEK_API_KEY")
            if not api_key:
                raise ValueError("DEEPSEEK_API_KEY is not configured.")
                
            from openai import OpenAI
            client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com/v1")
            model_name = model_override or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
            
            try:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "user", "content": prompt}
                    ],
                    stream=False
                )
                return response.choices[0].message.content
            except Exception as e:
                raise Exception(f"DeepSeek query failed: {str(e)}")
                
        elif provider == "openai":
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("OPENAI_API_KEY is not configured.")
                
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
            model_name = model_override or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
            
            try:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "user", "content": prompt}
                    ],
                    stream=False
                )
                return response.choices[0].message.content
            except Exception as e:
                raise Exception(f"OpenAI query failed: {str(e)}")
                
        else:
            raise ValueError(f"Unknown AI Provider: {provider}")
