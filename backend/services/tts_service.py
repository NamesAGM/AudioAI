import os
import uuid
import tempfile
import asyncio
import subprocess
from typing import List, Dict, Any
from google.cloud import texttospeech
import edge_tts

# Try to import pydub, but make it optional
try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except (ImportError, ModuleNotFoundError):
    print("⚠ pydub not available - audio merging will be limited")
    PYDUB_AVAILABLE = False

class TTSService:
    def __init__(self):
        self.google_client = None
        self.google_available = False
        
        # Check if Google Credentials exist
        creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "credentials.json")
        if os.path.exists(creds_path):
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = creds_path
            
        try:
            # Try to initialize Google Cloud TTS client
            self.google_client = texttospeech.TextToSpeechClient()
            self.google_available = True
            print("Google Cloud TTS client initialized successfully.")
        except Exception as e:
            print(f"Google Cloud TTS not available (credentials missing or invalid): {e}")
            print("Falling back to Edge-TTS for all conversions.")

    async def synthesize_chunks(self, chunks: List[str], settings: Dict[str, Any], output_file_path: str) -> bool:
        """
        Synthesizes list of text chunks into a single audio file.
        settings can include:
           - voice_name: e.g. 'en-US-Neural2-F' (Google) or 'en-US-EmmaMultilingualNeural' (Edge)
           - language_code: e.g. 'en-US'
           - speaking_rate: float (speed multiplier, e.g. 1.0)
           - gender: 'MALE' | 'FEMALE' | 'NEUTRAL'
        """
        temp_files = []
        
        try:
            # We will generate a temp file for each chunk
            for i, chunk in enumerate(chunks):
                temp_fd, temp_path = tempfile.mkstemp(suffix=".mp3")
                os.close(temp_fd)
                temp_files.append(temp_path)
                
                success = await self._synthesize_single_chunk(chunk, settings, temp_path)
                if not success:
                    raise Exception(f"Failed to synthesize chunk {i}")
            
            # Merge all temp files into the final output path
            if len(temp_files) == 1:
                # Just rename/move the file if there's only one chunk
                if os.path.exists(output_file_path):
                    os.remove(output_file_path)
                os.rename(temp_files[0], output_file_path)
                temp_files = [] # clear so we don't try to delete it
            else:
                # Merge multiple audio files
                if PYDUB_AVAILABLE:
                    # Use pydub to merge
                    combined = AudioSegment.empty()
                    for path in temp_files:
                        segment = AudioSegment.from_mp3(path)
                        combined += segment
                    combined.export(output_file_path, format="mp3")
                else:
                    # Use ffmpeg to concatenate files
                    concat_list = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
                    try:
                        # Create ffmpeg concat file
                        for path in temp_files:
                            concat_list.write(f"file '{path}'\n")
                        concat_list.close()
                        
                        # Run ffmpeg to concatenate
                        cmd = [
                            'ffmpeg', '-f', 'concat', '-safe', '0',
                            '-i', concat_list.name,
                            '-c', 'copy', output_file_path, '-y'
                        ]
                        result = subprocess.run(cmd, capture_output=True, text=True)
                        if result.returncode != 0:
                            print(f"FFmpeg error: {result.stderr}")
                            raise Exception(f"FFmpeg concat failed: {result.stderr}")
                    finally:
                        os.remove(concat_list.name)
                
            return True
            
        except Exception as e:
            print(f"Error during synthesis pipeline: {e}")
            return False
        finally:
            # Clean up any leftover temp files
            for path in temp_files:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except Exception as err:
                        print(f"Failed to delete temp file {path}: {err}")

    async def _synthesize_single_chunk(self, text: str, settings: Dict[str, Any], temp_output_path: str) -> bool:
        """
        Synthesizes a single chunk using Google TTS (if available and selected) or falling back to Edge TTS.
        """
        voice_id = settings.get("voice_name", "en-US-AvaNeural")
        
        # Determine provider by looking up voice_id in available voices
        provider = "edge"
        for voice_info in self.get_available_voices():
            if voice_info["id"] == voice_id:
                provider = voice_info["provider"]
                break
        
        use_google = (provider == "google") and self.google_available and not settings.get("force_fallback", False)
        
        if use_google:
            try:
                # Setup voice preferences
                language_code = settings.get("language_code", "en-US")
                speaking_rate = float(settings.get("speaking_rate", 1.0))
                
                # Check gender string
                gender_str = settings.get("gender", "FEMALE").upper()
                gender = texttospeech.SsmlVoiceGender.NEUTRAL
                if gender_str == "MALE":
                    gender = texttospeech.SsmlVoiceGender.MALE
                elif gender_str == "FEMALE":
                    gender = texttospeech.SsmlVoiceGender.FEMALE
                
                synthesis_input = texttospeech.SynthesisInput(text=text)
                
                voice = texttospeech.VoiceSelectionParams(
                    language_code=language_code,
                    name=voice_id,
                    ssml_gender=gender
                )
                
                audio_config = texttospeech.AudioConfig(
                    audio_encoding=texttospeech.AudioEncoding.MP3,
                    speaking_rate=speaking_rate
                )
                
                # Call API synchronously in run_in_executor to avoid blocking
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    None,
                    lambda: self.google_client.synthesize_speech(
                        input=synthesis_input, voice=voice, audio_config=audio_config
                    )
                )
                
                with open(temp_output_path, "wb") as out:
                    out.write(response.audio_content)
                return True
                
            except Exception as e:
                print(f"Google Cloud TTS failed for {voice_id}: {e}. Falling back to Edge TTS.")
                # Fall through to edge-tts fallback
                
        # Edge TTS (completely free, neural voices, zero setup)
        try:
            language_code = settings.get("language_code", "en-US")
            gender_str = settings.get("gender", "FEMALE").upper()
            
            # If the requested voice is an edge voice, use it directly.
            # Otherwise, map Google voice attributes to closest Edge voice.
            if provider == "edge":
                voice = voice_id
            else:
                # Simple mapping heuristics for fallback from Google to Edge
                voice = "en-US-AvaNeural" # Default
                if language_code.startswith("en"):
                    voice = "en-US-GuyNeural" if gender_str == "MALE" else "en-US-AvaNeural"
                elif language_code.startswith("es"):
                    voice = "es-ES-AlvaroNeural" if gender_str == "MALE" else "es-ES-ElviraNeural"
                elif language_code.startswith("fr"):
                    voice = "fr-FR-HenriNeural" if gender_str == "MALE" else "fr-FR-EloiseNeural"
                elif language_code.startswith("de"):
                    voice = "de-DE-ConradNeural" if gender_str == "MALE" else "de-DE-AmalaNeural"
            
            # Let explicit settings override if valid for edge-tts
            if "edge_voice" in settings:
                voice = settings["edge_voice"]
                
            # Speaking rate adjust format for edge-tts (e.g. "+0%", "-10%", "+20%")
            rate_val = float(settings.get("speaking_rate", 1.0))
            if rate_val == 1.0:
                rate_str = "+0%"
            else:
                pct = int((rate_val - 1.0) * 100)
                rate_str = f"{pct:+d}%"
                
            communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate_str)
            await communicate.save(temp_output_path)
            return True
            
        except Exception as e:
            print(f"Edge TTS failed: {e}")
            return False
            
    def get_available_voices(self) -> List[Dict[str, str]]:
        """
        Returns list of voices supported by this service.
        """
        # Static representative list of voices for simplicity in user interface
        return [
            # Edge Voice definitions (free neural voices, zero setup)
            {"id": "en-US-AvaNeural", "name": "Edge US English (Female) - Ava", "provider": "edge", "lang": "en-US", "gender": "FEMALE"},
            {"id": "en-US-GuyNeural", "name": "Edge US English (Male) - Guy", "provider": "edge", "lang": "en-US", "gender": "MALE"},
            {"id": "en-US-EmmaNeural", "name": "Edge US English (Female) - Emma", "provider": "edge", "lang": "en-US", "gender": "FEMALE"},
            {"id": "en-US-AndrewNeural", "name": "Edge US English (Male) - Andrew", "provider": "edge", "lang": "en-US", "gender": "MALE"},
            {"id": "en-GB-SoniaNeural", "name": "Edge UK English (Female) - Sonia", "provider": "edge", "lang": "en-GB", "gender": "FEMALE"},
            {"id": "en-GB-RyanNeural", "name": "Edge UK English (Male) - Ryan", "provider": "edge", "lang": "en-GB", "gender": "MALE"},
            {"id": "es-ES-ElviraNeural", "name": "Edge Spanish (Female) - Elvira", "provider": "edge", "lang": "es-ES", "gender": "FEMALE"},
            {"id": "es-ES-AlvaroNeural", "name": "Edge Spanish (Male) - Alvaro", "provider": "edge", "lang": "es-ES", "gender": "MALE"},
            {"id": "fr-FR-EloiseNeural", "name": "Edge French (Female) - Eloise", "provider": "edge", "lang": "fr-FR", "gender": "FEMALE"},
            {"id": "fr-FR-HenriNeural", "name": "Edge French (Male) - Henri", "provider": "edge", "lang": "fr-FR", "gender": "MALE"}
        ]
