import asyncio
import os
import sys
from services.tts_service import TTSService

async def test_tts():
    print("Initializing TTS Service...")
    tts = TTSService()
    
    text = "Hello! Welcome to the Audio AI conversion system. This audio is generated automatically to verify that the speech engine is functioning properly."
    chunks = [text]
    
    settings = {
        "voice_name": "en-US-Neural2-F",
        "language_code": "en-US",
        "speaking_rate": 1.0,
        "gender": "FEMALE"
    }
    
    output_path = "test_output.mp3"
    print(f"Synthesizing text: '{text}'")
    print(f"Output will be saved to: {output_path}")
    
    success = await tts.synthesize_chunks(chunks, settings, output_path)
    
    if success and os.path.exists(output_path):
        print(f"SUCCESS! Audio file generated successfully at {os.path.abspath(output_path)}")
        print(f"File size: {os.path.getsize(output_path)} bytes")
    else:
        print("FAILED! Speech synthesis failed or output file was not created.")

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(test_tts())
