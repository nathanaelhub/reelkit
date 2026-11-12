# Open tools worth knowing (researched 2026-11-12)

A survey of open-source tools that could join reelkit, and of the projects most like it. Stars, licences and dates were read from the GitHub API and Hugging Face model cards on 2026-11-12; check them again before relying on them. "Commercial-safe" means both the code and the model weights are under a permissive licence (MIT, Apache-2.0, BSD or CC-BY); tools free only below a revenue or employee cap are marked conditional, and reelkit only ever offers those as clearly labelled add-ons.

## Top 6 to add next (ranked by value to reelkit)

| # | Tool | Step it improves | Why | Default? |
|---|------|------------------|-----|----------|
| 1 | **Chatterbox-Turbo / Nano** (resemble-ai/chatterbox) | Voice | MIT code **and** MIT weights. Zero-shot voice cloning from a short clip. Native `[laugh]`/`[chuckle]` tags. Nano (110M) runs about 3x realtime on 8 CPU cores. Official ONNX exports exist (`ResembleAI/chatterbox-turbo-ONNX`, `onnx-community/chatterbox-ONNX`). This gives reelkit the "my own voice" feature that Kokoro cannot do. | Optional engine at first. It could become the default for cloning once the ONNX path works from Node. |
| 2 | **BiRefNet / BEN2 via ONNX** (ZhengPeng7/BiRefNet, PramaLLC/BEN2) | Photos → cutouts and parallax layers | MIT code and MIT weights. ONNX builds exist (`onnx-community/BiRefNet_lite-ONNX`, `onnx-community/BEN2-ONNX`), so they should run under transformers.js, which reelkit already uses (see Flags). Subject cutouts pair with the existing Depth Anything layers for 2.5D parallax, "subject over text" titles, and clean thumbnails. | **Add by default** |
| 3 | **ACE-Step 1.5** (ace-step/ACE-Step-1.5) | Music | MIT code and MIT weights (`ACE-Step/Ace-Step1.5`). It generates full songs, with or without vocals, locally. It runs on Mac (MPS/MLX), CPU and CUDA, in under 4 GB of VRAM. Much richer music beds than Tone.js. Caveat: the README warns about stylistic similarity to copyrighted works, so the user should check originality. | Optional add-on (Python plus several GB of weights). Keep Tone.js as the default. |
| 4 | **Real-ESRGAN (ncnn-vulkan binary)** plus **Swin2SR in transformers.js** | Upscaling low-res photos and frames before Ken Burns zooms | Real-ESRGAN is BSD-3. The ncnn-vulkan build is a single binary with no Python and runs on Apple, AMD and NVIDIA GPUs. `Xenova/swin2SR-*` is Apache-2.0 and runs in Node. This prevents soft or mushy zooms on 1080p source photos. | Swin2SR by default (Node-native). Real-ESRGAN binary as optional (licence metadata unclear, see Flags). |
| 5 | **SAM 2.1 via transformers.js** (facebookresearch/sam2) | Masks: spotlight, blur-behind, object callouts | Apache-2.0 code and weights (`facebook/sam2.1-hiera-small`). ONNX builds in `onnx-community` allow click or box-prompted masks in Node. Video tracking still needs Python. | Optional at first. Image-only masks could become default. |
| 6 | **Wan 2.2 TI2V-5B** (Wan-Video/Wan2.2) | Image → short motion clip (animating a still) | Apache-2.0 code and weights. It is the most capable fully permissive image-to-video model at a size a single consumer GPU can handle. LTX-2 is faster but revenue-gated. | Optional add-on (Python, CUDA, about 24 GB VRAM class GPU; slow on Mac) |

Cheap wins outside the top 6:
- **`onnx-community/Kokoro-82M-v1.0-ONNX-timestamped`** (Apache-2.0, transformers.js). A Kokoro export that appears to return timing information. If it does, reelkit could get word timing from the TTS itself and skip the Whisper alignment pass for its own narration. *I did not verify the output format; the model card shows only the plain `kokoro-js` usage.*
- **Pocket TTS** (kyutai-labs/pocket-tts). A 100M-parameter model that runs on CPU, does voice cloning, and has in-browser ports. Code is MIT, weights are **CC-BY-4.0** (commercial use OK with attribution). The cloning weights are click-through gated; `kyutai/pocket-tts-without-voice-cloning` is not.

---

## 1. TTS / voice cloning

| Tool | What it does | Code licence | Weights licence | Commercial-safe | Stars / last push | Plugs into | Install weight | Verdict |
|---|---|---|---|---|---|---|---|---|
| **Chatterbox** – https://github.com/resemble-ai/chatterbox | Zero-shot cloning TTS. Turbo is 350M (English, paralinguistic tags), Nano is 110M (CPU), Multilingual V3 is 500M (23+ languages) | MIT | MIT (`ResembleAI/chatterbox`, `-turbo`, `-nano`, `-flash`, `-turbo-ONNX`) | **Yes** | 27.8k / 2026-11-04 | Voice step (alternative engine to Kokoro) | PyTorch Python package, or the ONNX exports (onnx-community also hosts multilingual ONNX). GPU optional for Nano. | **Optional add-on now. Strong default candidate for cloning.** |
| **Pocket TTS** – https://github.com/kyutai-labs/pocket-tts | 100M CPU TTS with cloning, about 6x realtime on M4 using 2 cores; browser ports exist | MIT | CC-BY-4.0 (cloning weights gated with click-through) | **Yes, with attribution** | 10.3k / 2026-11-12 | Voice step | Python (CPU torch). Community GGUF, CoreML and MLX ports. | Optional. The lightest cloning option. |
| **Qwen3-TTS** – https://github.com/QwenLM/Qwen3-TTS | 0.6B and 1.7B multilingual TTS with cloning and voice design | Apache-2.0 | Apache-2.0 | **Yes** | 14.4k / 2026-03-17 | Voice step | Python, GPU recommended | Optional (multilingual / voice-design) |
| **VoxCPM 2** – https://github.com/OpenBMB/VoxCPM | Tokenizer-free TTS with cloning; very popular | Apache-2.0 | Apache-2.0 (`openbmb/VoxCPM2`) | **Yes** | 42.4k / 2026-11-09 | Voice step | Python, GPU | Optional. Worth an A/B test against Chatterbox. |
| CosyVoice 3 – https://github.com/FunAudioLLM/CosyVoice (now QwenAudio/CosyVoice) | 0.5B multilingual streaming TTS | Apache-2.0 | Apache-2.0 | Yes | 24.4k / 2026-05-25 | Voice | Python, GPU | Optional (Chinese-strong) |
| Dia / Dia2 – https://github.com/nari-labs/dia | Dialogue TTS (two speakers, nonverbals) | Apache-2.0 | Apache-2.0 | Yes | 19.4k / 2025-11-19 | Voice (two-voice skits) | Python, GPU | Niche optional |
| NeuTTS Air – https://github.com/neuphonic/neutts | On-device cloning TTS | Repo licence unclear (NOASSERTION) | Air weights Apache-2.0; **Nano weights "other"/gated (not read)** | Air: likely yes | 6.3k / 2026-07-30 | Voice | Python, CPU | Skip (Chatterbox Nano covers this) |
| Supertonic – supertone-oss-archive/supertonic | Very fast ONNX TTS, runs in Node and browser | MIT | **OpenRAIL** (use restrictions) | Conditional | 13.8k / **repo archived** | Voice | ONNX, tiny | Skip (archived) |
| Piper – rhasspy/piper → OHF-Voice/piper1-gpl | Fast VITS TTS | Old repo MIT and **archived**; successor is **GPL-3.0** | Per voice (varies) | GPL for new versions | 11.3k / 6.3k | — | — | Skip (GPL; Kokoro is better) |
| F5-TTS – SWivid/F5-TTS | Cloning TTS | MIT | **CC-BY-NC-4.0** | **No** | 15.6k / 2026-11-03 | — | — | Non-commercial add-on only, if at all |
| Fish Speech / OpenAudio – fishaudio/fish-speech | High-quality cloning | Fish Audio Community License (Oct 2026): free only under a revenue threshold | Fish 1.5: CC-BY-NC-SA-4.0 | **No / conditional** | 33.7k / 2026-11-12 | — | — | Skip |
| IndexTTS 2 – index-tts/index-tts | Emotion and duration-controlled cloning | bilibili Model Use License (custom) | custom | Unclear, terms not fully read | 25.1k / 2026-09-29 | — | — | Skip unless the licence is reviewed |
| ChatTTS – 2noise/ChatTTS | Conversational TTS | AGPL-3.0 | NC | No | 40k | — | — | Skip |
| Kyutai TTS 1.6B (delayed-streams-modeling) | Streaming TTS | Apache-2.0 | CC-BY-4.0 | Yes (attribution) | 3.1k / 2026-01-26 | — | GPU | Skip (Pocket TTS is the practical Kyutai option) |

Note: `k2-fsa/sherpa-onnx` (already in use) is very active (Apache-2.0, 15.9k stars, release 2026-11-11). Check its model zoo before writing a new runtime. It may already ship an ONNX export of one of these models.

## 2. Music / SFX generation

| Tool | What it does | Code | Weights | Commercial-safe | Stars / last push | Plugs into | Install | Verdict |
|---|---|---|---|---|---|---|---|---|
| **ACE-Step 1.5** – https://github.com/ace-step/ACE-Step-1.5 | Text/lyrics → full song, edit and continue | MIT | MIT (`ACE-Step/Ace-Step1.5`); v1 (ace-step/ACE-Step) was Apache-2.0 | **Yes** (README asks users to check outputs for stylistic copying) | 14.7k / 2026-11-08 | Music step (generated bed instead of Tone.js) | Python. 2B turbo DiT runs in ≤6 GB VRAM with INT8 and CPU offload; XL needs ≥12 GB. Mac MPS/MLX and CPU supported. | **Optional add-on (top pick for music)** |
| **Stable Audio 3 Small-SFX / Small-Music** – https://github.com/Stability-AI/stable-audio-3 | 433M text-to-audio models that run on CPU (5s of audio in 0.7s on Mac CPU); SFX and music variants; inpainting; LoRA support | MIT | **Stability AI Community License**: free commercial use under **$1M annual revenue**, enterprise licence above that (confirmed on stability.ai/license); HF weights gated with click-through | **Conditional** | 870 / 2026-11-02 (released Oct 2026) | SFX layer (whooshes, door, waves, ambience) and short stingers | Python (uv). CPU or CoreML on Mac, about 2 GB. | **Optional add-on, clearly labelled.** Best local SFX option. |
| YuE – https://github.com/multimodal-art-projection/YuE | Lyrics → full song with vocals | Apache-2.0 | Apache-2.0 | Yes | 13.4k / 2026-11-01 | Music | 7B LM, heavy CUDA GPU (24 GB+ class) | Skip (ACE-Step is lighter and faster) |
| HeartMuLa – https://github.com/HeartMuLa/heartlib | Song generation | Apache-2.0 | Apache-2.0 (`HeartMuLa-oss-3B`) | Yes | 3.8k / 2026-10-08 | Music | 3B, GPU | Watch list |
| Magenta RealTime – https://github.com/magenta/magenta-realtime | Live, steerable music generation | Apache-2.0 | CC-BY-4.0 | Yes (attribution) | 1.9k / 2026-10-02 | Music | JAX/TPU-oriented, not checked on Mac | Skip for now |
| DiffRhythm – ASLP-lab/DiffRhythm | Fast full-song diffusion | Apache-2.0 | HF card lists apache-2.0 **and** `stable-audio-community` (uses the SAO VAE) | Conditional | 2.4k / 2025-11-27 | — | — | Skip (licence muddled) |
| Stable Audio Open 1.0 / Small | Older Stability audio models | MIT (stable-audio-tools) | Stability Community License | Conditional | 3.9k | — | — | Replaced by Stable Audio 3 |
| MusicGen / AudioGen (audiocraft) | Music and SFX | MIT | **CC-BY-NC-4.0** | **No** | 23.9k | — | — | NC add-on only |
| MMAudio – hkchengrex/MMAudio | Video → synced foley | MIT | **CC-BY-NC-4.0** | **No** | 2.3k | — | — | NC add-on only |
| HunyuanVideo-Foley | Video → foley | Tencent Hunyuan Community (excludes EU, UK, South Korea) | same | Conditional or territorial | 1.1k | — | — | Skip |
| ThinkSound – QwenAudio/ThinkSound | Video → audio | No SPDX licence detected on repo | HF card says Apache-2.0 | Unverified | 1.4k / 2026-04-03 | SFX | GPU | Watch list (repo licence unclear) |

## 3. Image / video generation and upscaling

| Tool | What it does | Code | Weights | Commercial-safe | Stars / last push | Plugs into | Install | Verdict |
|---|---|---|---|---|---|---|---|---|
| **FLUX.2 [klein] 4B** – https://github.com/black-forest-labs/flux2 | Fast text→image and editing | Apache-2.0 | **Apache-2.0** (`FLUX.2-klein-4B`, ungated) | **Yes** | 2.9k / 2026-03-12 | B-roll stills or backgrounds when no photos are supplied | Python, roughly 12-16 GB GPU class; Mac MPS possible | Optional add-on |
| FLUX.1 [schnell] | Older 12B fast text→image | Apache-2.0 | Apache-2.0 | Yes | 26.1k (flux repo, 2025-07) | same | Heavy | Superseded by klein |
| FLUX.1-dev / FLUX.2-dev | — | — | **Non-commercial** | No | — | — | — | NC only |
| **Z-Image-Turbo** – https://github.com/Tongyi-MAI/Z-Image | 6B few-step text→image, strong text rendering | Apache-2.0 | Apache-2.0 | **Yes** | 12.1k / 2026-02-09 | same as FLUX.2 klein | Python, GPU | Optional (alternative to klein) |
| Qwen-Image | 20B text→image and editing | Apache-2.0 | Apache-2.0 | Yes | — | same | Very heavy | Skip for local default |
| **Wan 2.2** – https://github.com/Wan-Video/Wan2.2 | T2V and I2V; TI2V-5B at 720p | Apache-2.0 | Apache-2.0 | **Yes** | 18.6k / 2026-09-21 | Animate stills into 3-5 s motion shots | Python, CUDA (5B fits about 24 GB) | **Optional add-on** |
| LTX-Video / LTX-2 – https://github.com/Lightricks/LTX-2 | Fast T2V/I2V; LTX-2 adds audio | Apache-2.0 | **LTX open-weights / LTX-2 Community licence**: entities with ≥$10M annual revenue need a paid licence | **Conditional** | LTX-2 10.2k / 2026-11-12 | same | GPU | Optional, labelled conditional |
| CogVideoX – zai-org/CogVideo | T2V/I2V | Apache-2.0 | CogVideoX-2B Apache-2.0; **5B and 1.5 use the CogVideoX licence** (registration required for commercial use, capped at 1M visits a month) | Conditional | 13.2k / 2025-11-04 | — | GPU | Skip (Wan beats it) |
| HunyuanVideo 1.5 | T2V/I2V | Tencent Hunyuan Community | same, **not valid in EU, UK or South Korea** | No (territorial) | 4.6k | — | — | Skip |
| **Real-ESRGAN** – https://github.com/xinntao/Real-ESRGAN (+ xinntao/Real-ESRGAN-ncnn-vulkan) | 2x/4x photo and video upscaler | BSD-3 (main repo) | Released with the repo (no separate weights licence found) | Yes, probably (see Flags) | 37.5k / **2024-08** (stale but stable) | Pre-pass on low-res photos before zoom/parallax | ncnn binary, no Python, any Vulkan/Metal GPU | Optional (stale, but a mature binary) |
| **Swin2SR** (transformers.js) – `Xenova/swin2SR-classical-sr-x2-64` | 2x super-resolution in Node | Apache-2.0 (transformers.js) | Apache-2.0 | **Yes** | model updated 2026-11-10 | same | Pure Node, small | **Add by default** (light upscaling) |
| SeedVR2 – https://github.com/ByteDance-Seed/SeedVR | One-step video restoration and upscaling | Apache-2.0 | Apache-2.0 (3B/7B) | Yes | 1.4k / 2026-01-27 | Upscale generated clips | Heavy GPU | Optional, only with Wan |
| Practical-RIFE – https://github.com/hzwer/Practical-RIFE | Frame interpolation (smooth slow-mo, 24→60 fps) | MIT | MIT (same repo) | Yes | 1.0k / 2026-08-27 | Smooth drone or slow-motion clips | Python, GPU; rife-ncnn-vulkan binary is MIT but stale (2024) | Optional |
| Upscayl | Upscaler desktop app | **AGPL-3.0** | — | Conditional | 52.3k | — | — | Skip (it is an app, not a library) |

## 4. Segmentation / background removal / matting

| Tool | What it does | Code | Weights | Commercial-safe | Stars / last push | Plugs into | Install | Verdict |
|---|---|---|---|---|---|---|---|---|
| **BiRefNet** – https://github.com/ZhengPeng7/BiRefNet | High-resolution dichotomous segmentation (background removal) | MIT | MIT (`ZhengPeng7/BiRefNet`, `onnx-community/BiRefNet_lite-ONNX`) | **Yes** | 4.4k / 2026-10-25 | Cutouts for parallax and title layering | ONNX; lite version runs in Node | **Add by default** |
| **BEN2** – https://github.com/PramaLLC/BEN2 | Background-erase network, strong on hair edges | MIT | MIT (`PramaLLC/BEN2`, `onnx-community/BEN2-ONNX`) | **Yes** | 297 / 2026-01-02 | same | ONNX | Default alternative. Benchmark against BiRefNet-lite. |
| **SAM 2.1** – https://github.com/facebookresearch/sam2 | Prompted image and video segmentation and tracking | Apache-2.0 | Apache-2.0 | **Yes** | 20.1k / 2026-05-30 | Masks, object spotlight, tracked blur | Image: ONNX in Node. Video: Python/GPU. | Optional, leaning default for image masks |
| SAM 3 – facebookresearch/sam3 | Text-prompted ("the pool") segmentation and tracking | SAM License (custom; royalty-free grant, read partially) | `facebook/sam3` **manually gated**, custom licence | Conditional (custom terms, manual approval) | 12.3k / 2026-11-10 | Text-prompted masks | Python/GPU | Optional, labelled. Licence needs a full read. |
| rembg – https://github.com/danielgatis/rembg | Background-removal CLI wrapping many models | MIT | Depends on model (u2net/isnet/BiRefNet permissive; **bria-rmbg is not**) | Conditional on model choice | 25.4k / 2026-11-06 | — | Python | Skip. Call BiRefNet directly from Node instead. |
| RMBG-2.0 – briaai | Background removal | — | **CC-BY-NC-4.0** (commercial use needs a Bria agreement). RMBG-1.4 uses the Bria custom licence. | **No** | — | — | — | NC only |
| imgly background-removal-js | Browser and Node background removal | **AGPL-3.0** | — | Conditional | 7.4k | — | — | Skip (AGPL) |
| RobustVideoMatting | Video matting | **GPL-3.0** | — | Conditional | 9.6k / 2024 | — | — | Skip |
| MatAnyone / MatAnyone2 | Video matting | **S-Lab License 1.0 (non-commercial)** | NC | **No** | 1.6k / 0.9k | — | — | NC add-on only |

## 5. Editing utilities

| Tool | What it does | Licence | Commercial-safe | Stars / last activity | Plugs into | Install | Verdict |
|---|---|---|---|---|---|---|---|
| **auto-editor** – https://github.com/WyattBlue/auto-editor | Silence and motion-based auto cuts; exports to Premiere, Resolve and FCP timelines | Unlicense | **Yes** | 5.9k / release 31.8.0 on 2026-10-30 | Cutting user-supplied talking-head footage; exporting an editable timeline | Now a Nim binary (no Python); brew/pip available | **Optional add-on** (reelkit's FFmpeg silencedetect covers the basics) |
| **PySceneDetect** – https://github.com/Breakthrough/PySceneDetect | Content and threshold scene-cut detection | BSD-3 | **Yes** | 5.4k / v0.7.3 on 2026-11-08 | Reference analysis (cut rhythm of downloaded references) | Python plus OpenCV | Optional (better than FFmpeg `scene` for adaptive cuts) |
| **WhisperX** – https://github.com/m-bain/whisperX | Faster-whisper ASR, wav2vec2 forced alignment, diarisation | BSD-2 | Code yes. Alignment and diarisation models have their own licences (pyannote is gated; **not verified**). | 25.2k / 2026-10-22 | Word timing for long user footage | Python, GPU recommended | Optional (transformers.js Whisper stays the default) |
| stable-ts – jianfch/stable-ts | Whisper timestamp stabilisation | MIT | Yes | 2.3k / **archived** | — | — | Skip (archived) |
| whisper-timestamped | Word timestamps | **AGPL-3.0** | Conditional | 2.9k | — | — | Skip |
| faster-whisper / whisper.cpp | Fast ASR runtimes | MIT | Yes | 26.7k / 55.1k, both active | Alternative ASR backend | whisper.cpp is native and has Node bindings | Optional (whisper.cpp if transformers.js Whisper is too slow on long inputs) |
| **HyperFrames** – https://github.com/heygen-com/hyperframes | "Write HTML. Render video. Built for agents." GSAP/HTML to MP4 | Apache-2.0 | **Yes** | 83.3k / 2026-11-12 | Same layer as reelkit's Playwright frame capture | Node | Competitor and reference. reelkit could also adopt it as a renderer. |
| Motion Canvas – https://github.com/motion-canvas/motion-canvas | Code-driven TypeScript animation | MIT | Yes | 19.8k / 2026-07-02 | Alternative scene authoring | Node | Skip (reelkit's HTML scenes already cover this) |
| Revideo – now midrender/revideo | Motion Canvas fork for programmatic rendering | MIT | Yes | 4.2k / 2026-07-15 | — | Node | Skip (moved and slowing) |
| editly – https://github.com/mifi/editly | Declarative JSON → video (Node + FFmpeg) | MIT | Yes | 5.6k / **2025-05** | — | Node | Skip (stale) |
| Remotion – remotion-dev/remotion | React → video | **Remotion License (source-available, not OSI)**: free for individuals, non-profits and for-profits with up to 3 employees; company licence above that | Conditional | 72.7k / 2026-11-12 | — | Node | Skip as a dependency. Note it in positioning. |
| MediaPipe (already in use) | — | Apache-2.0 | Yes | 37.7k / active | Face reframing (already used) | — | Keep |

## 6. Similar end-to-end "AI short video" projects (positioning)

| Project | What it does | Licence | Stars / last push | How reelkit differs |
|---|---|---|---|---|
| **MoneyPrinterTurbo** – https://github.com/harry0703/MoneyPrinterTurbo | Topic → LLM script → stock footage (Pexels/Pixabay) → TTS (Edge/Azure/etc.) → subtitles → MP4; web UI | MIT | **142.8k** / release v1.3.10 on 2026-11-07 | Needs LLM and stock-footage API keys and mostly cloud TTS. Output is stock-clip montage. reelkit is fully local, works from the user's own photos with designed HTML scenes, and has an agent as the operator. |
| **HyperFrames** (HeyGen) – https://github.com/heygen-com/hyperframes | HTML/GSAP → video framework "built for agents" | Apache-2.0 | 83.3k / 2026-11-12 | Closest in philosophy (agent writes HTML, gets video). It is a renderer only. reelkit is the whole pipeline (voice, timing, music, depth, reframing). |
| MoneyPrinterV2 – FujiwaraChoki/MoneyPrinterV2 | Automation for YouTube Shorts, Twitter bots and affiliate posts | **AGPL-3.0** | 32.4k / 2026-09-15 | Growth automation rather than craft; AGPL licence. |
| MoneyPrinter (v1) – FujiwaraChoki/MoneyPrinter | Original topic → short | MIT | 14.2k / 2026-03 | Same as above, simpler. |
| NarratoAI – https://github.com/linyqh/NarratoAI | LLM commentary narration over existing footage, auto-cut | MIT | 11.8k / 2026-10-24 | Edits existing long video (commentary niche, Chinese-first). Cloud LLM. |
| ShortGPT – RayVentura/ShortGPT | Experimental automation framework for Shorts | MIT | 8.2k / **2025-02 (stale)** | Stale; ElevenLabs and cloud-centric. |
| OpenShorts – https://github.com/mutonby/openshorts | Long video → viral 9:16 clips (moment detection, face tracking, subtitles, dubbing); MCP server | MIT (self-host) plus paid cloud | 7.9k / 2026-11-12 | Clipper, a different job (repurposing long video). |
| AI-Youtube-Shorts-Generator – Anil-matcha | Long YouTube → shorts via LLM highlights, Whisper and auto-crop | MIT | 6.0k / 2026-11-12 | Clipper; cloud LLM. |
| claude-code-video-toolkit – https://github.com/digitalsamba/claude-code-video-toolkit | Claude Code skills and templates: script, voice (Qwen3-TTS), LTX-2 b-roll, music, render | MIT | 2.5k / 2026-11-12 | **Most similar audience** (coding-agent driven). Uses **Remotion** (licence caveat) and cloud GPU calls ("costs cents"). reelkit is local-first and Remotion-free with commercial-safe defaults. |
| Verticals (youtube-shorts-pipeline) – https://github.com/rushindrasinha/youtube-shorts-pipeline | Topic → researched, scripted, uploaded Short; niche intelligence | MIT | 2.4k / 2026-06-09 | Upload and growth focus; mixes cloud providers. |
| short-video-maker – https://github.com/gyoridavid/short-video-maker | MCP/REST short generator (Kokoro, Whisper, Pexels, Remotion) | MIT (Remotion dependency) | 1.5k / **2025-06 (stale)** | Similar local stack, but stock-footage based, Remotion-bound and stale. |
| OpenReels – https://github.com/tsensei/openreels | Topic → Short; web UI; ElevenLabs/Gemini/Kokoro | MIT | 241 / 2026-04 | API-key driven, small. |
| claude-video-kit – runesleo/claude-video-kit | Agent skill: explainer video with TTS, Whisper and Remotion | MIT (Remotion dependency) | 124 / 2026-11-12 | Small. Uses Remotion and Fish Audio cloud. |

**Positioning summary.** The large projects (MoneyPrinterTurbo, NarratoAI, the clippers) are web-UI or Python apps that use cloud LLMs, stock footage and API-key TTS. The agent-native newcomers (claude-code-video-toolkit, claude-video-kit, short-video-maker) mostly depend on Remotion, whose licence is not OSI, or on paid cloud GPUs. reelkit's combination appears to be distinctive:
- fully local, no API keys
- commercial-safe code **and** weights by default
- HTML scenes rendered through Chromium, with no Remotion
- built around the user's own photos (depth parallax, face reframing)
- driven by a coding agent

## 7. Node / browser-runnable notes

These look runnable in reelkit's Node/transformers.js stack today (I have not run any of them):
- Kokoro (`kokoro-js` 1.2.1, Apache-2.0) and the timestamped ONNX variant
- Chatterbox ONNX (MIT; `onnx-community/chatterbox-ONNX`, `chatterbox-multilingual-ONNX`, `ResembleAI/chatterbox-turbo-ONNX`). transformers.js support is implied by the onnx-community hosting, not confirmed.
- BiRefNet-lite and BEN2 ONNX (MIT)
- SAM 2.1 ONNX (`onnx-community/sam2.1-hiera-tiny-ONNX`)
- Swin2SR (Apache-2.0)
- Pocket TTS (browser ports exist per its README)

`@huggingface/transformers` is at 4.3.2 (2026-10-30).

The heavy generative models (Wan, FLUX.2 klein, ACE-Step, Stable Audio 3) are Python and PyTorch. Treat them as optional sidecars invoked by the CLI, never as default dependencies.

---

## Flags / not verified

- **Real-ESRGAN-ncnn-vulkan**: the repo's SPDX licence is NOASSERTION (custom or undetected). The main Real-ESRGAN repo is BSD-3, and I found no separate weights licence. Read the ncnn repo's LICENSE before bundling it.
- **Kokoro timestamped ONNX**: I could not confirm from the model card how word timings are exposed.
- **Chatterbox in transformers.js**: ONNX exports exist and are MIT, but I did not confirm that transformers.js or kokoro-js-style JavaScript runs them end to end. The README no longer mentions a watermark; I did not verify whether one is still embedded.
- **SAM 3 licence**: the grant reads as royalty-free with no explicit non-commercial clause, but I read only the first part. Weights need manual approval.
- **WhisperX**: the licences of the alignment (wav2vec2) and diarisation (pyannote) models were not checked.
- **ThinkSound**: GitHub shows no licence; the HF card says Apache-2.0.
- **IndexTTS 2 and NeuTTS Nano**: custom or gated licences, not fully read.
- **Hardware figures**: VRAM numbers for Wan 2.2 and FLUX.2 klein are approximate, based on project positioning. ACE-Step and Stable Audio 3 figures come from their READMEs.
- **Star counts** are live API values from 2026-11-12. "Last push" is not always a release date.
