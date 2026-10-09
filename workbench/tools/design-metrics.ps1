#requires -Version 5.1
# Stored without an extension; prepare-scripts restores design-metrics.ps1.
[CmdletBinding()]
param([string]$OutputPath, [switch]$LibraryOnly)
$ErrorActionPreference = 'Stop'
function Get-DesignMetricsScript {
    # This program must execute inside the browser to inspect the live DOM.
    # Single-quoted here-string: no interpolation of JavaScript or page data.
    $payload = @'
/*
 * Zero-dependency measurements for design review. Browser: DesignMetrics;
 * CommonJS: require('./design-metrics.js'). No full accessibility verdict.
 * References and review process: ../docs/DESIGN_QUALITY.md.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DesignMetrics = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function finiteNumber(value, name, minimum, maximum) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(name + " must be a finite number");
    }
    if (value < minimum || value > maximum) {
      throw new RangeError(name + " is outside the supported range");
    }
    return value;
  }

  function rgb(value, name) {
    if (!Array.isArray(value) || value.length !== 3) {
      throw new TypeError(name + " must be an explicit three-channel RGB array");
    }
    return [0, 1, 2].map(function (index) {
      return finiteNumber(value[index], name + "[" + index + "]", 0, 255);
    });
  }

  function luminance(channels) {
    var linear = channels.map(function (channel) {
      var value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }

  /** Explicit, opaque sRGB colors only; no alpha, CSS parsing or DOM backgrounds. */
  function contrastRgb(foreground, background) {
    var first = luminance(rgb(foreground, "foreground"));
    var second = luminance(rgb(background, "background"));
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  }

  /**
   * Simplified conventional-font classification, not a complete WCAG check.
   * Font weight is numeric 1..1000. Thin/unusual fonts, symbols, scripts,
   * exceptions and the actual presentation require separate review.
   * Compare the unrounded ratio against this threshold; 4.499 is below 4.5.
   */
  function textContrastThreshold(fontSizePx, fontWeight) {
    finiteNumber(fontSizePx, "fontSizePx", Number.MIN_VALUE, Number.MAX_VALUE);
    finiteNumber(fontWeight, "fontWeight", 1, 1000);
    return fontSizePx >= 24 || (fontWeight >= 700 && fontSizePx >= 14 * 96 / 72)
      ? 3 : 4.5;
  }

  function positiveOption(options, name, fallback, integer, maximum) {
    var value = Object.prototype.hasOwnProperty.call(options, name) ? options[name] : fallback;
    finiteNumber(value, name, Number.MIN_VALUE, maximum);
    if (integer && !Number.isInteger(value)) throw new TypeError(name + " must be an integer");
    return value;
  }

  // Only structural selectors: never emit text, values, names, IDs or classes.
  function structuralSelector(element) {
    var segments = [];
    var current = element;
    var maxDepth = 40;
    while (current && current.nodeType === 1 && segments.length < maxDepth) {
      var name = String(current.localName || "");
      var safeName = /^[a-zA-Z][a-zA-Z0-9-]*$/.test(name) ? name : "*";
      var index = 1;
      var sibling = current.previousElementSibling;
      while (sibling) {
        if (safeName === "*" || sibling.localName === current.localName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      segments.unshift(safeName + (safeName === "*" ? ":nth-child(" : ":nth-of-type(") + index + ")");
      current = current.parentElement;
    }
    return { selector: segments.join(" > "), selectorTruncated: !!current };
  }

  function geometry(rect) {
    return {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height
    };
  }

  function hasDirectTextNode(element) {
    // Node type inspection only: whitespace-only text is intentionally not read.
    for (var i = 0; i < element.childNodes.length; i += 1) {
      if (element.childNodes[i].nodeType === 3) return true;
    }
    return false;
  }

  /**
   * Observe the current document and scroll position, in CSS pixels.
   * options: productFontSizePx (16), primaryTargetPx (44), maxRecords (100),
   * maxElements (10000). Marker: presence of data-design-primary.
   * Call in an authorized page/context; this reads layout, never text or values.
   * Lists are candidates for human review, not violations or proof of compliance.
   */
  function collect(document, options) {
    if (!document || document.nodeType !== 9 || !document.documentElement ||
        !document.defaultView || typeof document.defaultView.getComputedStyle !== "function" ||
        typeof document.createTreeWalker !== "function") {
      throw new TypeError("collect requires a live browser Document");
    }
    options = options === undefined ? {} : options;
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("options must be an object");
    }
    var productFontSizePx = positiveOption(options, "productFontSizePx", 16, false, 1000);
    var primaryTargetPx = positiveOption(options, "primaryTargetPx", 44, false, 10000);
    var maxRecords = positiveOption(options, "maxRecords", 100, true, 10000);
    var maxElements = positiveOption(options, "maxElements", 10000, true, 1000000);
    var root = document.documentElement;
    var view = document.defaultView;
    var viewportWidth = root.clientWidth;
    var viewportHeight = root.clientHeight;
    if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) ||
        viewportWidth <= 0 || viewportHeight <= 0) {
      throw new TypeError("collect requires a document with a measurable layout viewport");
    }
    var scrollWidth = Math.max(root.scrollWidth, document.body ? document.body.scrollWidth : 0);
    var visual = view.visualViewport;
    var report = {
      schemaVersion: 1,
      tool: "DesignMetrics",
      scope: "Current light DOM, current state and scroll position; CSS-pixel geometry only.",
      viewport: {
        units: "CSS px", width: viewportWidth, height: viewportHeight,
        devicePixelRatio: view.devicePixelRatio,
        scrollX: view.scrollX, scrollY: view.scrollY,
        visualViewport: visual ? {
          width: visual.width, height: visual.height, offsetLeft: visual.offsetLeft,
          offsetTop: visual.offsetTop, scale: visual.scale
        } : null
      },
      horizontalOverflow: {
        documentScrollWidthPx: scrollWidth,
        layoutViewportWidthPx: viewportWidth,
        observedWidthDifferencePx: Math.max(0, scrollWidth - viewportWidth),
        reviewRequired: true
      },
      thresholds: {
        smallTargetCandidatePx: 24,
        productFontSizePx: productFontSizePx,
        primaryTargetPx: primaryTargetPx,
        classification: "24 is a screening threshold; 16/44 defaults are configurable product targets, not universal requirements."
      },
      scan: { maxElements: maxElements, elementsVisited: 0, visibleGeometryElements: 0 },
      limits: { maxRecords: maxRecords, recordsEmitted: 0 },
      counts: {
        controlsMeasured: 0, smallTargetCandidates: 0, primaryControlsMeasured: 0,
        smallPrimaryTargetCandidates: 0, textElementsMeasured: 0,
        smallTextCandidates: 0, outOfViewportCandidates: 0
      },
      controls: [],
      smallTextCandidates: [],
      outOfViewportCandidates: [],
      omittedRecords: { controls: 0, smallTextCandidates: 0, outOfViewportCandidates: 0 },
      truncated: false,
      reviewRequired: true,
      unknown: [
        "WCAG conformance is not assessed; no aggregate quality score is produced.",
        "Target spacing and inline/equivalent/essential/user-agent exceptions are not assessed.",
        "Actual hit areas, associated labels, pseudo-elements and overlapping targets are not resolved.",
        "Clipping, occlusion, nested scrolling and intended offscreen content require review.",
        "iframe contents and shadow DOM are not traversed; coverage is unknown.",
        "Text/background contrast is unknown: transparency, gradients, images and compositing are not resolved.",
        "Text is never read; direct text-node presence can include whitespace, and generated text can be missed.",
        "Controls without recognized semantics can be missed; disabled/hidden behavior requires review.",
        "Only the current state and viewport are measured; other states, viewports and keyboard behavior are unknown."
      ]
    };
    var hiddenSubtrees = new WeakMap();
    var controlSelector = "button,input:not([type='hidden']),select,textarea,a[href],summary," +
      "[role='button'],[role='link'],[role='checkbox'],[role='radio'],[role='switch']," +
      "[role='tab'],[role='menuitem'],[role='slider'],[tabindex],[contenteditable='true'],[data-design-primary]";

    function emit(category, element, rect, details) {
      if (report.limits.recordsEmitted >= maxRecords) {
        report.omittedRecords[category] += 1;
        report.truncated = true;
        return;
      }
      var identity = structuralSelector(element);
      report[category].push(Object.assign(identity, { rect: geometry(rect) }, details));
      report.limits.recordsEmitted += 1;
    }

    // SHOW_ELEMENT=1 avoids dependency on a NodeFilter global from another realm.
    var walker = document.createTreeWalker(root, 1);
    var element = root;
    while (element && report.scan.elementsVisited < maxElements) {
      report.scan.elementsVisited += 1;
      var style = view.getComputedStyle(element);
      var parentHidden = element.parentElement && hiddenSubtrees.get(element.parentElement);
      var subtreeHidden = !!parentHidden || style.display === "none" ||
        style.contentVisibility === "hidden" || Number.parseFloat(style.opacity) === 0;
      hiddenSubtrees.set(element, subtreeHidden);
      var rect = element.getBoundingClientRect();
      var visibleGeometry = !subtreeHidden && style.visibility !== "hidden" &&
        style.visibility !== "collapse" && element.getClientRects().length > 0 &&
        rect.width > 0 && rect.height > 0;
      if (visibleGeometry) {
        report.scan.visibleGeometryElements += 1;
        if (element.matches(controlSelector)) {
          report.counts.controlsMeasured += 1;
          var small = rect.width < 24 || rect.height < 24;
          var primary = element.hasAttribute("data-design-primary");
          var smallPrimary = primary && (rect.width < primaryTargetPx || rect.height < primaryTargetPx);
          if (small) report.counts.smallTargetCandidates += 1;
          if (primary) report.counts.primaryControlsMeasured += 1;
          if (smallPrimary) report.counts.smallPrimaryTargetCandidates += 1;
          emit("controls", element, rect, {
            smallTargetCandidate: small, primaryMarker: primary,
            belowPrimaryProductTarget: smallPrimary, reviewRequired: true
          });
        }
        var fontSize = Number.parseFloat(style.fontSize);
        var textControl = element.matches("input:not([type='hidden']),textarea,select");
        if ((textControl || hasDirectTextNode(element)) && Number.isFinite(fontSize)) {
          report.counts.textElementsMeasured += 1;
          if (fontSize < productFontSizePx) {
            report.counts.smallTextCandidates += 1;
            emit("smallTextCandidates", element, rect, {
              fontSizePx: fontSize, productTargetPx: productFontSizePx, reviewRequired: true
            });
          }
        }
        if (element !== root && element !== document.body &&
            (rect.left < 0 || rect.top < 0 || rect.right > viewportWidth || rect.bottom > viewportHeight)) {
          report.counts.outOfViewportCandidates += 1;
          emit("outOfViewportCandidates", element, rect, {
            edges: {
              left: rect.left < 0, top: rect.top < 0,
              right: rect.right > viewportWidth, bottom: rect.bottom > viewportHeight
            },
            note: "Below-the-fold content and intentional scrolling are not automatically defects.",
            reviewRequired: true
          });
        }
      }
      element = walker.nextNode();
    }
    report.scan.elementsRemainingUnknown = !!element;
    if (element) report.truncated = true;
    return report;
  }

  return Object.freeze({ contrastRgb: contrastRgb, textContrastThreshold: textContrastThreshold, collect: collect });
});
'@
    return ($payload.Replace("`r`n", "`n") + "`n")
}
if ($LibraryOnly) { return }
try {
    $payload = Get-DesignMetricsScript
    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        [Console]::Write($payload)
    } else {
        $path = [IO.Path]::GetFullPath($OutputPath)
        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($payload)
        # No overwrite: a previous accepted artifact must retain its original content.
        $stream = New-Object IO.FileStream($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $digest = ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
        @{path=$path; sha256=$digest; bytes=$bytes.Length; runtime='browser-javascript'; browser_executed=$false} | ConvertTo-Json -Depth 10
    }
} catch {
    @{status='error'; error=$_.Exception.Message} | ConvertTo-Json -Depth 10
    exit 2
}
