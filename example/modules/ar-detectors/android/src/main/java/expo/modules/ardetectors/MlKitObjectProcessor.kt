package expo.modules.ardetectors

import android.graphics.Rect
import android.media.Image
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Frame
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.objects.ObjectDetection
import com.google.mlkit.vision.objects.defaults.ObjectDetectorOptions
import expo.modules.ar.ExpoArFrameProcessor
import java.util.UUID

// Example ML Kit frame processor implementing expo-ar's ExpoArFrameProcessor seam. It runs ML Kit
// object detection on the AR session's own ARCore Frame (camera-exclusivity — no second camera),
// then lifts each box into world space with the supplied raycast closure. Emits detection maps whose
// keys match the Detection contract.
//
// Uses ML Kit's bundled default detector (zero asset, coarse 5-category labels). Swap for a custom
// LiteRT/TFLite model via ObjectDetectorOptions for production accuracy.
class MlKitObjectProcessor : ExpoArFrameProcessor {
  override val activeModelLabel = "ML Kit (bundled)"

  private val detector =
    ObjectDetection.getClient(
      ObjectDetectorOptions.Builder()
        .setDetectorMode(ObjectDetectorOptions.STREAM_MODE)
        .enableClassification()
        .enableMultipleObjects()
        .build()
    )

  override fun process(
    frame: Frame,
    viewWidth: Int,
    viewHeight: Int,
    minConfidence: Double,
    raycast: (Float, Float) -> Map<String, Any?>,
    onResult: (List<Map<String, Any?>>) -> Unit,
  ) {
    // Acquire synchronously while the frame is current; may be briefly unavailable.
    val image: Image =
      try {
        frame.acquireCameraImage()
      } catch (_: Exception) {
        onResult(emptyList())
        return
      }

    // rotation = 0: keep ML Kit boxes in the sensor IMAGE_PIXELS space that transformCoordinates2d
    // (IMAGE_PIXELS → VIEW) expects; ARCore handles the sensor→view rotation/aspect for us.
    val input = InputImage.fromMediaImage(image, 0)
    detector
      .process(input)
      .addOnSuccessListener { objects ->
        val dets =
          objects.mapNotNull { obj ->
            val label = obj.labels.firstOrNull()
            val confidence = label?.confidence ?: 0f
            if (confidence < minConfidence) return@mapNotNull null

            val box = obj.boundingBox
            val centerView = imageToView(frame, box.exactCenterX(), box.exactCenterY())
            val hit = raycast(centerView[0], centerView[1]) // view PIXELS; view bridges px→dp
            mapOf(
              "id" to (obj.trackingId?.toString() ?: UUID.randomUUID().toString()),
              "label" to (label?.text ?: "object"),
              "confidence" to confidence.toDouble(),
              "bbox" to normalizedBox(frame, box, viewWidth, viewHeight),
              "worldTransform" to hit["worldTransform"],
            )
          }
        onResult(dets)
      }
      .addOnCompleteListener {
        // MUST close — unclosed images exhaust ARCore's buffer pool and stall the session.
        image.close()
      }
  }

  // Map an IMAGE_PIXELS point to VIEW pixels via ARCore's coordinate transform (handles rotation +
  // image-vs-view aspect — far more reliable than hand-rolled math).
  private fun imageToView(frame: Frame, x: Float, y: Float): FloatArray {
    val out = FloatArray(2)
    frame.transformCoordinates2d(
      Coordinates2d.IMAGE_PIXELS, floatArrayOf(x, y), Coordinates2d.VIEW, out
    )
    return out
  }

  // View-normalized (0–1, top-left origin) bbox: map two opposite corners IMAGE→VIEW, then divide by
  // the view size. min/max guard against the corners flipping under rotation.
  private fun normalizedBox(frame: Frame, box: Rect, viewWidth: Int, viewHeight: Int): Map<String, Any?> {
    val tl = imageToView(frame, box.left.toFloat(), box.top.toFloat())
    val br = imageToView(frame, box.right.toFloat(), box.bottom.toFloat())
    val x0 = minOf(tl[0], br[0])
    val y0 = minOf(tl[1], br[1])
    val x1 = maxOf(tl[0], br[0])
    val y1 = maxOf(tl[1], br[1])
    val w = viewWidth.toFloat().coerceAtLeast(1f)
    val h = viewHeight.toFloat().coerceAtLeast(1f)
    return mapOf(
      "x" to (x0 / w).toDouble(),
      "y" to (y0 / h).toDouble(),
      "w" to ((x1 - x0) / w).toDouble(),
      "h" to ((y1 - y0) / h).toDouble(),
    )
  }
}
