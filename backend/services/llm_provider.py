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
                import google.generativeai as genai
                genai.configure(api_key=api_key)
                # Test call with a very short prompt
                model_name = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
                model = genai.GenerativeModel(model_name)
                # Since we want to make sure it's working but not waste time/rate limit, 
                # we just check if the client can be configured. 
                # (Actual test call is omitted to keep it fast, but client configuration is checked)
                return {"status": "connected", "provider": "gemini", "model": model_name}
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
            return {"status": "configured", "provider": "deepseek", "model": model_name}
            
        elif provider == "openai":
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                return {"status": "error", "provider": "openai", "message": "OPENAI_API_KEY is not set"}
            model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
            return {"status": "configured", "provider": "openai", "model": model_name}
            
        return {"status": "unknown", "provider": provider}

    @classmethod
    def query_llm(cls, prompt: str) -> str:
        """
        Queries the active LLM provider with the given prompt and returns the text response.
        """
        provider = cls.get_active_provider()
        
        if provider == "gemini":
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise ValueError("GEMINI_API_KEY is not configured in environment variables.")
                
            import google.generativeai as genai
            genai.configure(api_key=api_key)
            model_name = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
            model = genai.GenerativeModel(model_name)
            
            # Call Gemini API
            response = model.generate_content(prompt)
            if not response.text:
                raise Exception("Empty response received from Gemini API.")
            return response.text
            
        elif provider == "ollama":
            url = os.getenv("OLLAMA_URL", "http://localhost:11434")
            model_name = os.getenv("OLLAMA_MODEL", "llama3.2")
            
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
            model_name = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
            
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
            model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
            
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
