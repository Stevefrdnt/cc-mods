// Dev only (macOS): reads the frames scripts/render-demo.mjs streams on
// stdin, draws each frame's text (captions, the header, toasts) with Core
// Text, and encodes them to an H.264 MP4 with AVFoundation. Given a .png
// path instead, it saves the first frame as a still (cropped if the header
// asks), for the README.
//
//   node scripts/render-demo.mjs | swift scripts/encode-video.swift docs/demo.mp4

import AVFoundation
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let output = CommandLine.arguments.dropFirst().first ?? "demo.mp4"
let stdin = FileHandle.standardInput

func readExact(_ n: Int) -> Data? {
    var data = Data(capacity: n)
    while data.count < n {
        let chunk = stdin.readData(ofLength: n - data.count)
        if chunk.isEmpty { return data.isEmpty ? nil : data }
        data.append(chunk)
    }
    return data
}

func readJSON() -> [String: Any]? {
    guard let lenData = readExact(4) else { return nil }
    let len = lenData.withUnsafeBytes { Int($0.loadUnaligned(as: UInt32.self).littleEndian) }
    guard let body = readExact(len) else { return nil }
    return try? JSONSerialization.jsonObject(with: body) as? [String: Any]
}

func color(_ hex: String, _ alpha: CGFloat = 1) -> CGColor {
    let v = Int(hex.dropFirst(), radix: 16) ?? 0
    return CGColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: alpha)
}

func font(_ t: [String: Any]) -> CTFont {
    let size = CGFloat(t["size"] as? Double ?? 20)
    if t["mono"] as? Bool == true { return CTFontCreateWithName("Menlo-Regular" as CFString, size, nil) }
    let kind: CTFontUIFontType = (t["weight"] as? String) == "bold" ? .emphasizedSystem : .system
    return CTFontCreateUIFontForLanguage(kind, size, nil) ?? CTFontCreateWithName("Helvetica" as CFString, size, nil)
}

// The frame's text, in top-left coordinates like the renderer's
func drawTexts(_ texts: [[String: Any]], in ctx: CGContext, height: Int) {
    let h = CGFloat(height)
    for t in texts {
        guard let s = t["text"] as? String else { continue }
        let alpha = CGFloat(t["alpha"] as? Double ?? 1)
        let f = font(t)
        let attrs = [kCTFontAttributeName: f, kCTForegroundColorAttributeName: color(t["color"] as? String ?? "#FFFFFF", alpha)] as CFDictionary
        let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, s as CFString, attrs))
        var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
        let width = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))
        var x = CGFloat(t["x"] as? Double ?? 0)
        let top = CGFloat(t["y"] as? Double ?? 0)
        switch t["align"] as? String {
        case "center": x -= width / 2
        case "right": x -= width
        default: break
        }
        if let box = t["box"] as? [String: Any] {
            let pad = CGFloat(box["pad"] as? Double ?? 8)
            let radius = CGFloat(box["radius"] as? Double ?? 8)
            let r = CGRect(x: x - pad, y: h - (top + ascent + descent + pad), width: width + pad * 2, height: ascent + descent + pad * 2)
            ctx.setFillColor(color(box["color"] as? String ?? "#000000", alpha))
            ctx.addPath(CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil))
            ctx.fillPath()
        }
        ctx.textPosition = CGPoint(x: x, y: h - top - ascent)
        CTLineDraw(line, ctx)
    }
}

guard let header = readJSON(), let width = header["width"] as? Int, let height = header["height"] as? Int else {
    FileHandle.standardError.write("no header on stdin\n".data(using: .utf8)!)
    exit(1)
}
let fps = Int32(header["fps"] as? Int ?? 30)
let frameBytes = width * height * 4
let bitmapInfo = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let url = URL(fileURLWithPath: output)
try? FileManager.default.removeItem(at: url)

if output.hasSuffix(".png") {
    // A still: the first frame, cropped as the header asks
    guard let json = readJSON(), var pixels = readExact(frameBytes) else { exit(1) }
    pixels.withUnsafeMutableBytes { raw in
        let ctx = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space, bitmapInfo: bitmapInfo)!
        drawTexts(json["texts"] as? [[String: Any]] ?? [], in: ctx, height: height)
        var image = ctx.makeImage()!
        if let c = header["crop"] as? [String: Int], let cropped = image.cropping(to: CGRect(x: c["x"]!, y: c["y"]!, width: c["w"]!, height: c["h"]!)) { image = cropped }
        let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(dest, image, nil)
        CGImageDestinationFinalize(dest)
    }
    print("wrote \(output)")
    exit(0)
}

let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 8_000_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    ],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

var index: Int64 = 0
while let json = readJSON(), let pixels = readExact(frameBytes) {
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
    guard let pb = buffer else { break }
    CVPixelBufferLockBaseAddress(pb, [])
    let base = CVPixelBufferGetBaseAddress(pb)!
    let rowBytes = CVPixelBufferGetBytesPerRow(pb)
    pixels.withUnsafeBytes { src in
        for y in 0..<height {
            memcpy(base + y * rowBytes, src.baseAddress! + y * width * 4, width * 4)
        }
    }
    let ctx = CGContext(data: base, width: width, height: height, bitsPerComponent: 8, bytesPerRow: rowBytes, space: space, bitmapInfo: bitmapInfo)!
    drawTexts(json["texts"] as? [[String: Any]] ?? [], in: ctx, height: height)
    CVPixelBufferUnlockBaseAddress(pb, [])
    while !input.isReadyForMoreMediaData { usleep(2000) }
    adaptor.append(pb, withPresentationTime: CMTime(value: index, timescale: fps))
    index += 1
}

input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed {
    FileHandle.standardError.write("encoding failed: \(String(describing: writer.error))\n".data(using: .utf8)!)
    exit(1)
}
print("wrote \(output): \(index) frames at \(fps) fps")
