param(
  [int]$Width = 4096,
  [int]$Height = 2048,
  [int]$JpegQuality = 94
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\textures\blackhole\gaia_sky.jpg'))
$output = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\textures\blackhole\gaia_sky_equirectangular.jpg'))
$metadata = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\textures\blackhole\gaia_sky_equirectangular.json'))

# The ESA raster is a Hammer-Aitoff ellipse inside a larger black JPEG. This
# converter evaluates the same direction -> Hammer map formerly used in the
# runtime shader, but writes a complete periodic longitude/latitude texture.
# A 0.25% radial guard extrapolates only the antialiased edge pixels and avoids
# mixing the black page background into the sky. No astronomical features are
# painted, cloned, or synthesized.
$code = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public sealed class GaiaProjectionMetrics {
  public double MeanSeamChannelDifference { get; set; }
  public int MaxSeamChannelDifference { get; set; }
  public long PureBlackPixels { get; set; }
}

public static class GaiaHammerConverter {
  const double SourceLeftEdge = 149.5;
  const double SourceRightEdge = 4149.5;
  const double SourceTopEdge = 353.5;
  const double SourceBottomEdge = 2353.5;
  const double SafeHammerRadius = 0.9975;
  const int SeamBlendColumns = 8;

  static int PixelOffset(int x, int y, int stride) { return y * stride + x * 3; }

  static bool InsideHammerPixel(int x, int y) {
    double hx = 2.0 * ((x - SourceLeftEdge) / (SourceRightEdge - SourceLeftEdge)) - 1.0;
    double hy = 2.0 * ((SourceBottomEdge - y) / (SourceBottomEdge - SourceTopEdge)) - 1.0;
    return hx * hx + hy * hy <= 1.0;
  }

  static void SampleMasked(byte[] source, int width, int height, int stride,
      double x, double y, out byte blue, out byte green, out byte red) {
    int x0 = Math.Max(0, Math.Min(width - 1, (int)Math.Floor(x)));
    int y0 = Math.Max(0, Math.Min(height - 1, (int)Math.Floor(y)));
    int x1 = Math.Min(width - 1, x0 + 1);
    int y1 = Math.Min(height - 1, y0 + 1);
    double fx = x - Math.Floor(x), fy = y - Math.Floor(y);
    int[] xs = { x0, x1, x0, x1 };
    int[] ys = { y0, y0, y1, y1 };
    double[] weights = {
      (1.0 - fx) * (1.0 - fy), fx * (1.0 - fy),
      (1.0 - fx) * fy, fx * fy
    };
    double sum = 0.0, b = 0.0, g = 0.0, r = 0.0;
    for (int index = 0; index < 4; ++index) {
      if (!InsideHammerPixel(xs[index], ys[index])) continue;
      int offset = PixelOffset(xs[index], ys[index], stride);
      double weight = weights[index];
      sum += weight;
      b += source[offset] * weight;
      g += source[offset + 1] * weight;
      r += source[offset + 2] * weight;
    }
    if (sum <= 1e-12) {
      int nearestX = Math.Max(0, Math.Min(width - 1, (int)Math.Round(x)));
      int nearestY = Math.Max(0, Math.Min(height - 1, (int)Math.Round(y)));
      int offset = PixelOffset(nearestX, nearestY, stride);
      blue = source[offset]; green = source[offset + 1]; red = source[offset + 2];
      return;
    }
    blue = (byte)Math.Max(0, Math.Min(255, Math.Round(b / sum)));
    green = (byte)Math.Max(0, Math.Min(255, Math.Round(g / sum)));
    red = (byte)Math.Max(0, Math.Min(255, Math.Round(r / sum)));
  }

  static ImageCodecInfo JpegCodec() {
    foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageEncoders()) {
      if (codec.FormatID == ImageFormat.Jpeg.Guid) return codec;
    }
    throw new InvalidOperationException("JPEG encoder is unavailable");
  }

  public static void Convert(string sourcePath, string outputPath,
      int outputWidth, int outputHeight, long jpegQuality) {
    using (Bitmap sourceBitmap = new Bitmap(sourcePath)) {
      Rectangle sourceRect = new Rectangle(0, 0, sourceBitmap.Width, sourceBitmap.Height);
      BitmapData sourceData = sourceBitmap.LockBits(
        sourceRect, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      int sourceStride = Math.Abs(sourceData.Stride);
      byte[] source = new byte[sourceStride * sourceBitmap.Height];
      Marshal.Copy(sourceData.Scan0, source, 0, source.Length);
      sourceBitmap.UnlockBits(sourceData);

      using (Bitmap outputBitmap = new Bitmap(outputWidth, outputHeight, PixelFormat.Format24bppRgb)) {
        Rectangle outputRect = new Rectangle(0, 0, outputWidth, outputHeight);
        BitmapData outputData = outputBitmap.LockBits(
          outputRect, ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
        int outputStride = Math.Abs(outputData.Stride);
        byte[] output = new byte[outputStride * outputHeight];

        for (int y = 0; y < outputHeight; ++y) {
          double latitude = Math.PI * (0.5 - (y + 0.5) / outputHeight);
          double sinLatitude = Math.Sin(latitude);
          double cosLatitude = Math.Cos(latitude);
          for (int x = 0; x < outputWidth; ++x) {
            double longitude = 2.0 * Math.PI * ((x + 0.5) / outputWidth - 0.5);
            double denominator = Math.Sqrt(Math.Max(1e-12,
              1.0 + cosLatitude * Math.Cos(0.5 * longitude)));
            double hx = cosLatitude * Math.Sin(0.5 * longitude) / denominator;
            double hy = sinLatitude / denominator;
            double radius = Math.Sqrt(hx * hx + hy * hy);
            if (radius > SafeHammerRadius) {
              double scale = SafeHammerRadius / radius;
              hx *= scale; hy *= scale;
            }
            double sourceX = SourceLeftEdge
              + (hx * 0.5 + 0.5) * (SourceRightEdge - SourceLeftEdge);
            double sourceY = SourceBottomEdge
              - (hy * 0.5 + 0.5) * (SourceBottomEdge - SourceTopEdge);
            byte b, g, r;
            SampleMasked(source, sourceBitmap.Width, sourceBitmap.Height,
              sourceStride, sourceX, sourceY, out b, out g, out r);
            int offset = PixelOffset(x, y, outputStride);
            output[offset] = b; output[offset + 1] = g; output[offset + 2] = r;
          }
        }

        // The two equirectangular edges are adjacent directions. Symmetrize a
        // sub-degree band so JPEG block compression cannot recreate a seam.
        for (int y = 0; y < outputHeight; ++y) {
          for (int k = 0; k < SeamBlendColumns; ++k) {
            int left = PixelOffset(k, y, outputStride);
            int right = PixelOffset(outputWidth - 1 - k, y, outputStride);
            // Average the complete outer JPEG block on both sides. Mirrored
            // block input keeps the encoded first/last texels periodic too.
            double blend = 1.0;
            for (int channel = 0; channel < 3; ++channel) {
              double average = 0.5 * (output[left + channel] + output[right + channel]);
              output[left + channel] = (byte)Math.Round(
                output[left + channel] * (1.0 - blend) + average * blend);
              output[right + channel] = (byte)Math.Round(
                output[right + channel] * (1.0 - blend) + average * blend);
            }
          }
        }

        Marshal.Copy(output, 0, outputData.Scan0, output.Length);
        outputBitmap.UnlockBits(outputData);
        EncoderParameters parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(
          System.Drawing.Imaging.Encoder.Quality, jpegQuality);
        outputBitmap.Save(outputPath, JpegCodec(), parameters);
        parameters.Dispose();
      }
    }
  }

  public static GaiaProjectionMetrics Measure(string path) {
    using (Bitmap bitmap = new Bitmap(path)) {
      Rectangle rect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
      BitmapData data = bitmap.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      int stride = Math.Abs(data.Stride);
      byte[] pixels = new byte[stride * bitmap.Height];
      Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
      bitmap.UnlockBits(data);
      long totalDifference = 0, channelCount = 0, black = 0;
      int maximumDifference = 0;
      for (int y = 0; y < bitmap.Height; ++y) {
        int left = PixelOffset(0, y, stride);
        int right = PixelOffset(bitmap.Width - 1, y, stride);
        for (int channel = 0; channel < 3; ++channel) {
          int difference = Math.Abs(pixels[left + channel] - pixels[right + channel]);
          totalDifference += difference; channelCount++;
          maximumDifference = Math.Max(maximumDifference, difference);
        }
        for (int x = 0; x < bitmap.Width; ++x) {
          int offset = PixelOffset(x, y, stride);
          if (pixels[offset] == 0 && pixels[offset + 1] == 0 && pixels[offset + 2] == 0) black++;
        }
      }
      return new GaiaProjectionMetrics {
        MeanSeamChannelDifference = (double)totalDifference / channelCount,
        MaxSeamChannelDifference = maximumDifference,
        PureBlackPixels = black
      };
    }
  }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing
[GaiaHammerConverter]::Convert($source, $output, $Width, $Height, $JpegQuality)
$metrics = [GaiaHammerConverter]::Measure($output)

$sourceImage = [Drawing.Image]::FromFile($source)
$sourceWidth = $sourceImage.Width
$sourceHeight = $sourceImage.Height
$sourceImage.Dispose()

$record = [ordered]@{
  projection = 'equirectangular, Galactic coordinates, longitude increases left'
  dimensions = @{ width = $Width; height = $Height }
  source = @{
    file = 'gaia_sky.jpg'
    dimensions = @{ width = $sourceWidth; height = $sourceHeight }
    sha256 = (Get-FileHash -Algorithm SHA256 $source).Hash
    hammerCropPixelEdges = @{ left = 149.5; right = 4149.5; top = 353.5; bottom = 2353.5 }
  }
  conversion = @{
    safeHammerRadius = 0.9975
    seamBlendColumns = 8
    jpegQuality = $JpegQuality
    generator = 'tools/generate_gaia_equirectangular.ps1'
  }
  validation = @{
    outputSha256 = (Get-FileHash -Algorithm SHA256 $output).Hash
    meanSeamChannelDifference = $metrics.MeanSeamChannelDifference
    maxSeamChannelDifference = $metrics.MaxSeamChannelDifference
    pureBlackPixels = $metrics.PureBlackPixels
  }
}
$json = $record | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($metadata, $json, (New-Object Text.UTF8Encoding($false)))

Write-Host "Wrote $output ($Width x $Height)"
Write-Host "Seam mean/max channel difference: $($metrics.MeanSeamChannelDifference) / $($metrics.MaxSeamChannelDifference)"
Write-Host "Pure black output pixels: $($metrics.PureBlackPixels)"
