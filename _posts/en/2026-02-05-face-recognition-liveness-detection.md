---
layout: post
title: "Face Recognition Is Easy. Liveness Is Not."
date: 2026-02-05 12:00:00 +0900
categories: [Development, Face Recognition]
tags: [face-recognition, liveness-detection, ML-Kit, IR-camera, security]
lang: en
slug: "031-en"
thumbnail: /assets/images/posts/031-face-recognition-liveness/thumbnail-en.png
---

I'm building an attendance kiosk with face recognition. At first, I bought an IR camera module without much thought. Seeing Apple put a notch and Dynamic Island on iPhones just for Face ID sensors, I figured there must be a good reason. They're sacrificing precious screen real estate for it.

But then a question hit me. **Toss FacePay processes payments using just RGB cameras (on smartphones or store tablets) without IR sensors.** A service where real money is at stake — using just an RGB camera? Does that actually work?

I had to try it myself.

## Building Face Recognition with Free Open Source

A free combo available for Android:
- **ML Kit** (Google) - Face detection
- **MobileFaceNet** (TFLite) - Face embedding extraction

```kotlin
// Face detection with ML Kit
val detector = FaceDetection.getClient(options)
val faces = detector.process(image)

// Extract 512-dim embedding with MobileFaceNet
val embedding = mobileFaceNet.getEmbedding(croppedFace)

// Cosine similarity matching (0.6+ = same person)
val similarity = cosineSimilarity(embedding, registeredEmbedding)
```

It worked surprisingly well. Register, recognize, match in under a second.

## But There Was a Problem

**Photos can fool it.**

I held up a friend's face photo to the camera and it recognized successfully. For an attendance system, this makes proxy check-ins way too easy.

## What is Liveness Detection?

It's technology that determines if a real, living person is in front of the camera. There are two main approaches.

### Active Liveness
Requires user actions:
- "Please blink your eyes"
- "Turn your head to the left"

ML Kit provides `leftEyeOpenProbability`, so blink detection is doable. However, this value is highly sensitive to lighting conditions, face angles, and glasses — resulting in frequent false positives in real-world use.

**Problem:** Can be bypassed with video playback.

### Passive Liveness
Automatic analysis without user action:
- Subtle facial muscle movements
- Skin color changes from blood flow (rPPG)
- Skin texture analysis
- Light reflection patterns

**Problem:** Requires advanced AI models. No practical free solution exists today.

## So How Does Toss Do It?

Searching around, Toss doesn't disclose technical details. What's known:

- **In-house AI** - Combined texture, depth, and motion analysis
- **Multi-layer security** - Liveness + face recognition + FDS (fraud detection)
- **Only Korean service to pass Privacy Commission pre-review**

It's the result of massive R&D investment. Not something an individual developer can replicate.

So Toss's case isn't about "RGB works too" — it's about "we built enough layers to make RGB work."

## What About Cloud APIs?

Paid, but viable options exist.

| Service | Method | Features |
|---------|--------|----------|
| AWS Rekognition | Active (light+motion) | Displays color sequence, detects screen reflection |
| Azure Face | Passive+Active | Passed iBeta Level 2 test (0% penetration rate*) |

*Under iBeta Level 2 test conditions. Multi-layer security is still recommended for real-world deployment.

Azure automatically switches to active mode in bright lighting conditions.

## Conclusion: There's a Reason Apple Can't Ditch the Notch

| Method | RGB Only? | Security | Cost |
|--------|-----------|----------|------|
| Blink detection (Active) | Yes | Low | Free |
| AI texture analysis | Yes | Medium | Can't DIY |
| Cloud API | Yes | High | Paid |
| IR Camera | No | High | Hardware purchase |

Achieving production-grade, large-scale liveness detection using only RGB cameras is extremely difficult in practice. For Toss-level security, you need:
1. Billions invested in AI model development
2. Pay for AWS/Azure API
3. Dedicated hardware like IR cameras

## Why IR is the Obvious Choice for Kiosks

When articles say "RGB works too," they mean **technically possible** — not **easy to implement**.

### Implementation Difficulty

**RGB Approach (Hard Mode)**
- AI must detect subtle differences between flat photos and real faces (light reflection, skin texture, blood flow)
- Open-source models perform poorly and get fooled by high-resolution photos
- Toss-level security requires proprietary models trained on hundreds of thousands of samples

**IR Approach (Easy Mode)**
- Infrared light reflects differently off paper/screens vs. human skin — that's physics, not AI
- Basic sensor readings can filter out fakes without complex models
- Development difficulty drops by orders of magnitude

### Cost Structure

**Enterprise Perspective (Prefers RGB)**
- Adding IR sensors to millions of smartphones costs hundreds of millions in component costs
- Hiring dozens of engineers to build RGB-based AI is cheaper at scale

**Individual/Small Team Perspective (Prefers IR)**
- Adding an IR module (tens of dollars per unit) to 10-100 kiosks is negligible
- API per-call fees or months of in-house AI development costs far more

### The Kiosk Environment

For a consumer app, you can't control whether users have IR cameras — so you're forced to make RGB work.

But **kiosks let you control the hardware**. Just add an IR camera and you're done. Bonus: IR cameras use infrared illumination, so recognition stays stable even in backlit or dark environments.

### RGB vs IR Comparison

| Factor | RGB Approach | IR Approach |
|--------|--------------|-------------|
| Security | Low without advanced AI (photos work) | High by default (material detection) |
| Implementation | Very Hard (custom AI models needed) | Easy (hardware does the work) |
| Initial Cost | Low (standard webcam) | Module cost added |
| Ongoing Cost | High (API fees or server costs) | $0 |
| Best For | Consumer mobile apps | Kiosks, door locks, attendance terminals |

---

Turns out buying the IR camera module was the right call. There's a reason Apple can't abandon the notch.

In the end, the real question isn't whether RGB works — but **who pays the cost of making spoofing expensive**.

---

## References

- [Toss FacePay Technical Analysis - Tech42](https://www.tech42.co.kr/tech-story-%ED%86%A0%EC%8A%A4-%ED%8E%98%EC%9D%B4%EC%8A%A4%ED%8E%98%EC%9D%B4%EC%99%80-%EC%96%BC%EA%B5%B4-%EC%9D%B8%EC%8B%9D-%EA%B8%B0%EC%88%A0%EC%9D%98-%EC%A7%84%ED%99%94-%EA%B7%B8%EB%A6%AC/)
- [AWS Rekognition Face Liveness](https://aws.amazon.com/rekognition/face-liveness/)
- [Azure Face Liveness Detection](https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/concept-face-liveness-detection)
- [Face Anti-Spoofing Survey 2024](https://www.mdpi.com/2076-3417/15/12/6891)
