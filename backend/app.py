# /backend/app.py

import os
import google.generativeai as genai
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from PIL import Image
import io
import json
import re
import base64
import requests

# Carga la clave API desde el archivo .env
load_dotenv()

app = Flask(__name__)
CORS(app) 

# --- CONFIGURACIÓN DE CLAVES Y PROVEEDORES ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_API_KEY_BACKUP = os.getenv("GEMINI_API_KEY_BACKUP")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
GOOGLE_CLOUD_API_KEY = os.getenv("GOOGLE_CLOUD_API_KEY")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")

# Configuración de generación para Gemini SDK
generation_config = {
    "temperature": 0.4,
    "top_p": 0.95,
    "top_k": 40,
    "max_output_tokens": 8192,
    "response_mime_type": "application/json",
}

# --- FUNCIONES DE PROVEEDORES ---

def call_gemini_sdk(api_key, content_parts, model_name="gemini-2.0-flash"):
    """Llamada directa usando Google Generative AI SDK"""
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name=model_name,
        generation_config=generation_config,
    )
    response = model.generate_content(content_parts)
    return response.text

def call_openrouter_api(api_key, content_parts, model_name="google/gemini-2.0-flash-001"):
    """Llamada a través de OpenRouter (OpenAI compatible)"""
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173", # Identificador para OpenRouter
        "X-Title": "GeoSINT Tool"
    }

    # Convertir content_parts al formato de OpenAI
    messages_content = []
    
    for part in content_parts:
        if isinstance(part, str):
            messages_content.append({"type": "text", "text": part})
        elif isinstance(part, Image.Image):
            # Convertir imagen PIL a base64
            buffered = io.BytesIO()
            part.save(buffered, format="JPEG")
            img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            messages_content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{img_str}"}
            })

    payload = {
        "model": model_name,
        "messages": [
            {"role": "user", "content": messages_content}
        ],
        "response_format": {"type": "json_object"} # Forzar JSON si es posible
    }

    response = requests.post(url, headers=headers, json=payload)
    
    if response.status_code != 200:
        raise Exception(f"OpenRouter Error {response.status_code}: {response.text}")
    
    data = response.json()
    if "choices" in data and len(data["choices"]) > 0:
        return data["choices"][0]["message"]["content"]
    else:
        raise Exception("OpenRouter returned no content")

# --- LISTA DE ESTRATEGIAS DE INTENTO ---
# Cada elemento es (nombre_proveedor, funcion_llamada, api_key)
providers = []

if GEMINI_API_KEY:
    providers.append(("Gemini Direct (Primary)", call_gemini_sdk, GEMINI_API_KEY))
if GEMINI_API_KEY_BACKUP:
    providers.append(("Gemini Direct (Backup)", call_gemini_sdk, GEMINI_API_KEY_BACKUP))
if OPENROUTER_API_KEY:
    providers.append(("OpenRouter (Fallback)", call_openrouter_api, OPENROUTER_API_KEY))

print(f"✓ Loaded {len(providers)} AI Providers")

def generate_content_safe(content_parts):
    """
    Itera sobre los proveedores disponibles hasta tener éxito
    """
    global providers
    
    if not providers:
        raise ValueError("No AI providers configured. Check .env file.")

    last_error = None

    for name, func, key in providers:
        try:
            print(f"Trying provider: {name}...")
            result_text = func(key, content_parts)
            return result_text # Retorna el texto JSON crudo
        except Exception as e:
            error_str = str(e).lower()
            print(f"⚠️ Provider {name} failed: {error_str}")
            last_error = e
            continue
    
    raise Exception(f"All providers failed. Last error: {str(last_error)}")

# --- GOOGLE VISION & MAPS ---
VISION_API_URL = f"https://vision.googleapis.com/v1/images:annotate?key={GOOGLE_CLOUD_API_KEY}" if GOOGLE_CLOUD_API_KEY else None

if GOOGLE_CLOUD_API_KEY:
    print("✓ Google Cloud Vision API configurada")
else:
    print("⚠️  Google Cloud Vision API no configurada")

def analyze_image_with_google_vision(image_bytes):
    """Analiza una imagen usando Google Cloud Vision API REST"""
    if not GOOGLE_CLOUD_API_KEY:
        return {"error": "Google Cloud API key not configured"}
    
    try:
        image_base64 = base64.b64encode(image_bytes).decode('utf-8')
        url = f"https://vision.googleapis.com/v1/images:annotate?key={GOOGLE_CLOUD_API_KEY}"
        payload = {
            "requests": [{
                "image": { "content": image_base64 },
                "features": [
                    { "type": "WEB_DETECTION", "maxResults": 10 },
                    { "type": "LANDMARK_DETECTION", "maxResults": 10 },
                    { "type": "TEXT_DETECTION", "maxResults": 10 }
                ]
            }]
        }
        response = requests.post(url, json=payload)
        if response.status_code != 200:
            return {"error": f"Google Vision API error: {response.status_code}", "details": response.text}
        
        result = response.json()
        if "responses" not in result or not result["responses"]:
            return {"error": "No response from Google Vision API"}
        
        vision_result = result["responses"][0]
        
        # Extract info (simplified for brevity, logic preserved)
        location_clues = []
        web_detection = vision_result.get("webDetection", {})
        
        if "webEntities" in web_detection:
            for entity in web_detection["webEntities"]:
                if entity.get("score", 0) > 0.3:
                    location_clues.append({"type": "web_entity", "description": entity.get("description"), "score": entity.get("score")})
        
        if "pagesWithMatchingImages" in web_detection:
            for page in web_detection["pagesWithMatchingImages"][:5]:
                if "pageTitle" in page:
                    location_clues.append({"type": "page_title", "description": page["pageTitle"], "url": page.get("url")})

        if "landmarkAnnotations" in vision_result:
            for landmark in vision_result["landmarkAnnotations"]:
                location_clues.append({"type": "landmark", "description": landmark.get("description"), "score": landmark.get("score", 0.8)})
        
        detected_text = vision_result["textAnnotations"][0].get("description", "") if vision_result.get("textAnnotations") else ""
        
        return {
            "location_clues": location_clues,
            "detected_text": detected_text,
            "web_entities": web_detection.get('webEntities', []),
            "visually_similar_images": web_detection.get('visuallySimilarImages', [])
        }
    except Exception as e:
        return {"error": f"Error calling Google Vision API: {str(e)}"}

def geocode_with_google_maps(location_name):
    """Geocodifica una ubicación usando Google Maps API"""
    if not GOOGLE_MAPS_API_KEY: return None
    try:
        url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {"address": location_name, "key": GOOGLE_MAPS_API_KEY}
        response = requests.get(url, params=params)
        if response.status_code == 200:
            data = response.json()
            if data["status"] == "OK" and data["results"]:
                res = data["results"][0]
                return {
                    "lat": res["geometry"]["location"]["lat"],
                    "lng": res["geometry"]["location"]["lng"],
                    "formatted_address": res["formatted_address"]
                }
        return None
    except: return None

def extract_location_from_vision_results(vision_results):
    """Helper para extraer pistas de Vision"""
    clues = []
    for entity in vision_results.get('web_entities', []):
        if entity.get('score', 0) > 0.3:
            clues.append({"text": entity.get('description'), "score": entity.get('score'), "source": "web_entity"})
    return clues

# --- RUTAS FLASK ---

@app.route("/", methods=["GET"])
def home():
    return f"GeoSINT v2.7 - Gemini 2.0 Flash ({len(providers)} active)"

@app.route("/api/analyze", methods=["POST"])
def analyze_image():
    images = []
    if 'image' in request.files:
        f = request.files['image']
        if f.filename: images.append(Image.open(io.BytesIO(f.read())))
    if 'images' in request.files:
        for f in request.files.getlist('images'):
            if f.filename: images.append(Image.open(io.BytesIO(f.read())))

    if not images: return jsonify({"error": "No images provided"}), 400
    if len(images) > 10: return jsonify({"error": "Max 10 images"}), 400

    try:
        is_multi = len(images) > 1
        base_prompt = """You are an elite OSINT Geospatial Forensic Analyst. Identify the location of the image(s) with precision.
CRITICAL:
1. ACCURACY: Do not guess. If unsure, give region.
2. NAVIGABLE: Prefer street view accessible locations.
3. VERIFICATION: Justify coordinates."""

        specific_instructions = """
CONTEXT + DETAIL MODE:
Synthesize context from wide shots and micro-evidence from close-ups. Triangulate location.""" if is_multi else """
ANALYSIS PROTOCOL:
Analyze signs, infrastructure, environment, and architecture."""

        json_format = """
Output JSON ONLY:
{
  "country": "Country",
  "region_or_city": "City/Region",
  "coordinates": "Lat, Lng",
  "confidence": "High/Medium/Low",
  "reasoning": "Explanation",
  "detailed_analysis": {
    "primary_coordinates": { "lat": 0.0, "lng": 0.0 },
    "alternative_locations": [{ "lat": 0.0, "lng": 0.0, "description": "Alt 1", "probability": "Med" }],
    "evidence": { "signage": "...", "infrastructure": "...", "architecture": "...", "environment": "...", "cultural_elements": "..." },
    "final_assessment": { "most_probable_location": "...", "certainty_percentage": 0, "primary_landmark": "..." }
  }
}"""
        
        final_prompt = base_prompt + specific_instructions + json_format
        content_parts = [final_prompt] + images
        
        # Usar el sistema multi-proveedor
        response_text = generate_content_safe(content_parts)
        
        # Limpiar respuesta (a veces OpenRouter/OpenAI devuelve markdown ```json ... ```)
        cleaned_text = response_text.replace("```json", "").replace("```", "").strip()
        
        return jsonify(json.loads(cleaned_text))

    except Exception as e:
        return jsonify({"error": f"Analysis failed: {str(e)}"}), 500

@app.route("/api/analyze-lens", methods=["POST"])
def analyze_with_google_lens():
    if 'image' not in request.files: return jsonify({"error": "No image"}), 400
    try:
        f = request.files['image']
        img_bytes = f.read()
        
        # 1. Vision API
        if GOOGLE_CLOUD_API_KEY:
            vis_res = analyze_image_with_google_vision(img_bytes)
            if "error" not in vis_res:
                clues = extract_location_from_vision_results(vis_res)
                if clues:
                    primary = clues[0]
                    coords = geocode_with_google_maps(primary["text"])
                    lat, lng = (coords["lat"], coords["lng"]) if coords else (None, None)
                    
                    return jsonify({
                        "country": "Detected via Vision API",
                        "region_or_city": primary["text"],
                        "coordinates": f"{lat}, {lng}" if lat else "Unknown",
                        "confidence": "High",
                        "reasoning": f"Visual match: {primary['text']}",
                        "detailed_analysis": {
                            "primary_coordinates": {"lat": lat, "lng": lng},
                            "alternative_locations": [],
                            "evidence": {"signage": primary["text"], "infrastructure": "Vision API", "architecture": "N/A", "environment": "N/A", "cultural_elements": "N/A"},
                            "final_assessment": {"most_probable_location": primary["text"], "certainty_percentage": int(primary["score"]*100), "primary_landmark": primary["text"]}
                        }
                    })

        # 2. Fallback AI
        img = Image.open(io.BytesIO(img_bytes))
        prompt = """Visual Search (Google Lens style). Find visual matches. Output JSON: { "country": "...", "region_or_city": "...", "coordinates": "...", "confidence": "...", "reasoning": "...", "detailed_analysis": {...} }"""
        
        resp_text = generate_content_safe([prompt, img])
        cleaned_text = resp_text.replace("```json", "").replace("```", "").strip()
        return jsonify(json.loads(cleaned_text))

    except Exception as e:
        return jsonify({"error": f"Lens analysis failed: {str(e)}"}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5001)