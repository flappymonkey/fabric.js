(function() {

  var fabric = global.fabric || (global.fabric = { }),
      clone = fabric.util.object.clone;
  function parseDecoration(object) {
    if (object.textDecoration) {
      object.textDecoration.indexOf('underline') > -1 && (object.underline = true);
      object.textDecoration.indexOf('line-through') > -1 && (object.linethrough = true);
      object.textDecoration.indexOf('overline') > -1 && (object.overline = true);
      delete object.textDecoration;
    }
  }

  /**
   * IText class (introduced in <b>v1.4</b>) Events are also fired with "text:"
   * prefix when observing canvas.
   * @class fabric.IText
   * @extends fabric.Text
   * @mixes fabric.Observable
   *
   * @fires changed
   * @fires selection:changed
   * @fires editing:entered
   * @fires editing:exited
   *
   * @return {fabric.IText} thisArg
   * @see {@link fabric.IText#initialize} for constructor definition
   *
   * <p>Supported key combinations:</p>
   * <pre>
   *   Move cursor:                    left, right, up, down
   *   Select character:               shift + left, shift + right
   *   Select text vertically:         shift + up, shift + down
   *   Move cursor by word:            alt + left, alt + right
   *   Select words:                   shift + alt + left, shift + alt + right
   *   Move cursor to line start/end:  cmd + left, cmd + right or home, end
   *   Select till start/end of line:  cmd + shift + left, cmd + shift + right or shift + home, shift + end
   *   Jump to start/end of text:      cmd + up, cmd + down
   *   Select till start/end of text:  cmd + shift + up, cmd + shift + down or shift + pgUp, shift + pgDown
   *   Delete character:               backspace
   *   Delete word:                    alt + backspace
   *   Delete line:                    cmd + backspace
   *   Forward delete:                 delete
   *   Copy text:                      ctrl/cmd + c
   *   Paste text:                     ctrl/cmd + v
   *   Cut text:                       ctrl/cmd + x
   *   Select entire text:             ctrl/cmd + a
   *   Quit editing                    tab or esc
   * </pre>
   *
   * <p>Supported mouse/touch combination</p>
   * <pre>
   *   Position cursor:                click/touch
   *   Create selection:               click/touch & drag
   *   Create selection:               click & shift + click
   *   Select word:                    double click
   *   Select line:                    triple click
   * </pre>
   */
  fabric.IText = fabric.util.createClass(fabric.Text, fabric.Observable, /** @lends fabric.IText.prototype */ {

    /**
     * Type of an object
     * @type String
     * @default
     */
    type: 'i-text',

    /**
     * Index where text selection starts (or where cursor is when there is no selection)
     * @type Number
     * @default
     */
    selectionStart: 0,

    /**
     * Index where text selection ends
     * @type Number
     * @default
     */
    selectionEnd: 0,

    /**
     * Color of text selection
     * @type String
     * @default
     */
    selectionColor: 'rgba(17,119,255,0.3)',

    /**
     * Indicates whether text is in editing mode
     * @type Boolean
     * @default
     */
    isEditing: false,

    /**
     * Indicates whether a text can be edited
     * @type Boolean
     * @default
     */
    editable: true,

    /**
     * Border color of text object while it's in editing mode
     * @type String
     * @default
     */
    editingBorderColor: 'rgba(102,153,255,0.25)',

    /**
     * Width of cursor (in px)
     * @type Number
     * @default
     */
    cursorWidth: 2,

    /**
     * Color of default cursor (when not overwritten by character style)
     * @type String
     * @default
     */
    cursorColor: '#333',

    /**
     * Delay between cursor blink (in ms)
     * @type Number
     * @default
     */
    cursorDelay: 1000,

    /**
     * Duration of cursor fadein (in ms)
     * @type Number
     * @default
     */
    cursorDuration: 600,

    /**
     * Indicates whether internal text char widths can be cached
     * @type Boolean
     * @default
     */
    caching: true,

    /**
     * @private
     */
    _reSpace: /\s|\n/,

    /**
     * @private
     */
    _currentCursorOpacity: 0,

    /**
     * @private
     */
    _selectionDirection: null,

    /**
     * @private
     */
    _abortCursorAnimation: false,

    /**
     * @private
     */
    __widthOfSpace: [],

    /**
     * Helps determining when the text is in composition, so that the cursor
     * rendering is altered.
     */
    inCompositionMode: false,

    /**
     * Constructor
     * @param {String} text Text string
     * @param {Object} [options] Options object
     * @return {fabric.IText} thisArg
     */
    initialize: function(text, options) {
      this.callSuper('initialize', text, options);
      this.initBehavior();
    },

    /**
     * Sets selection start (left boundary of a selection)
     * @param {Number} index Index to set selection start to
     */
    setSelectionStart: function(index) {
      index = Math.max(index, 0);
      this._updateAndFire('selectionStart', index);
    },

    /**
     * Sets selection end (right boundary of a selection)
     * @param {Number} index Index to set selection end to
     */
    setSelectionEnd: function(index) {
      index = Math.min(index, this.text.length);
      this._updateAndFire('selectionEnd', index);
    },

    /**
     * @private
     * @param {String} property 'selectionStart' or 'selectionEnd'
     * @param {Number} index new position of property
     */
    _updateAndFire: function(property, index) {
      if (this[property] !== index) {
        this._fireSelectionChanged();
        this[property] = index;
      }
      this._updateTextarea();
    },

    /**
     * Fires the even of selection changed
     * @private
     */
    _fireSelectionChanged: function() {
      this.fire('selection:changed');
      this.canvas && this.canvas.fire('text:selection:changed', { target: this });
    },

    /**
     * Initialize text dimensions. Render all text on given context
     * or on a offscreen canvas to get the text width with measureText.
     * Updates this.width and this.height with the proper values.
     * Does not return dimensions.
     * @private
     */
    initDimensions: function() {
      this.isEditing && this.initDelayedCursor();
      this.clearContextTop();
      this.callSuper('initDimensions');
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    render: function(ctx) {
      this.clearContextTop();
      this.callSuper('render', ctx);
      // clear the cursorOffsetCache, so we ensure to calculate once per renderCursor
      // the correct position but not at every cursor animation.
      this.cursorOffsetCache = { };
      this.renderCursorOrSelection();
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _render: function(ctx) {
      this.callSuper('_render', ctx);
    },

    /**
     * Prepare and clean the contextTop
     */
    clearContextTop: function(skipRestore) {
      if (!this.isEditing) {
        return;
      }
      if (this.canvas && this.canvas.contextTop) {
        var ctx = this.canvas.contextTop, v = this.canvas.viewportTransform;
        ctx.save();
        ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
        this.transform(ctx);
        this.transformMatrix && ctx.transform.apply(ctx, this.transformMatrix);
        this._clearTextArea(ctx);
        skipRestore || ctx.restore();
      }
    },

    /**
     * Renders cursor or selection (depending on what exists)
     */
    renderCursorOrSelection: function() {
      if (!this.isEditing || !this.canvas) {
        return;
      }
      var boundaries = this._getCursorBoundaries(), ctx;
      if (this.canvas && this.canvas.contextTop) {
        ctx = this.canvas.contextTop;
        this.clearContextTop(true);
      }
      else {
        ctx = this.canvas.contextContainer;
        ctx.save();
      }
      if (this.selectionStart === this.selectionEnd) {
        this.renderCursor(boundaries, ctx);
      }
      else {
        this.renderSelection(boundaries, ctx);
      }
      ctx.restore();
    },

    _clearTextArea: function(ctx) {
      // we add 4 pixel, to be sure to do not leave any pixel out
      var width = this.width + 4, height = this.height + 4;
      ctx.clearRect(-width / 2, -height / 2, width, height);
    },

    /**
     * Returns cursor boundaries (left, top, leftOffset, topOffset)
     * @private
     * @param {Array} chars Array of characters
     * @param {String} typeOfBoundaries
     */
    _getCursorBoundaries: function(position) {

      // left/top are left/top of entire text box
      // leftOffset/topOffset are offset from that left/top point of a text box

      if (typeof position === 'undefined') {
        position = this.selectionStart;
      }

      var left = this._getLeftOffset(),
          top = this._getTopOffset(),
          offsets = this._getCursorBoundariesOffsets(position);

      return {
        left: left,
        top: top,
        leftOffset: offsets.left,
        topOffset: offsets.top
      };
    },

    /**
     * @private
     */
    _getCursorBoundariesOffsets: function(position) {
      if (this.cursorOffsetCache && 'top' in this.cursorOffsetCache) {
        return this.cursorOffsetCache;
      }
      var lineLeftOffset,
          lineIndex,
          charIndex,
          topOffset = 0,
          leftOffset = 0,
          boundaries,
          cursorPosition = this.get2DCursorLocation(position);
      charIndex = cursorPosition.charIndex;
      lineIndex = cursorPosition.lineIndex;
      for (var i = 0; i < lineIndex; i++) {
        topOffset += this.getHeightOfLine(i);
      }
      lineLeftOffset = this._getLineLeftOffset(lineIndex);
      var bound = this.__charBounds[lineIndex][charIndex];
      bound && (leftOffset = bound.left);
      if (this.charSpacing !== 0 && charIndex === this._textLines[lineIndex].length) {
        leftOffset -= this._getWidthOfCharSpacing();
      }
      boundaries = {
        top: topOffset,
        left: lineLeftOffset + (leftOffset > 0 ? leftOffset : 0),
      };
      this.cursorOffsetCache = boundaries;
      return this.cursorOffsetCache;
    },

    /**
     * Renders cursor
     * @param {Object} boundaries
     * @param {CanvasRenderingContext2D} ctx transformed context to draw on
     */
    renderCursor: function(boundaries, ctx) {
      var cursorLocation = this.get2DCursorLocation(),
          lineIndex = cursorLocation.lineIndex,
          charIndex = cursorLocation.charIndex > 0 ? cursorLocation.charIndex - 1 : 0,
          charHeight = this.getValueOfPropertyAt(lineIndex, charIndex, 'fontSize'),
          multiplier = this.scaleX * this.canvas.getZoom(),
          cursorWidth = this.cursorWidth / multiplier,
          topOffset = boundaries.topOffset,
          dy = this.getValueOfPropertyAt(lineIndex, charIndex, 'deltaY');

      topOffset += (1 - this._fontSizeFraction) * this.getHeightOfLine(lineIndex) / this.lineHeight
        - charHeight * (1 - this._fontSizeFraction);

      if (this.inCompositionMode) {
        this.renderSelection(boundaries, ctx);
      }

      ctx.fillStyle = this.getValueOfPropertyAt(lineIndex, charIndex, 'fill');
      ctx.globalAlpha = this.__isMousedown ? 1 : this._currentCursorOpacity;
      ctx.fillRect(
        boundaries.left + boundaries.leftOffset - cursorWidth / 2,
        topOffset + boundaries.top + dy,
        cursorWidth,
        charHeight);
    },

    /**
     * Renders text selection
     * @param {Object} boundaries Object with left/top/leftOffset/topOffset
     * @param {CanvasRenderingContext2D} ctx transformed context to draw on
     */
    renderSelection: function(boundaries, ctx) {

      var selectionStart = this.inCompositionMode ? this.hiddenTextarea.selectionStart : this.selectionStart,
          selectionEnd = this.inCompositionMode ? this.hiddenTextarea.selectionEnd : this.selectionEnd,
          isJustify = this.textAlign.indexOf('justify') !== -1,
          start = this.get2DCursorLocation(selectionStart),
          end = this.get2DCursorLocation(selectionEnd),
          startLine = start.lineIndex,
          endLine = end.lineIndex,
          startChar = start.charIndex < 0 ? 0 : start.charIndex,
          endChar = end.charIndex < 0 ? 0 : end.charIndex;

      for (var i = startLine; i <= endLine; i++) {
        var lineOffset = this._getLineLeftOffset(i) || 0,
            lineHeight = this.getHeightOfLine(i),
            realLineHeight = 0, boxStart = 0, boxEnd = 0;

        if (i === startLine) {
          boxStart = this.__charBounds[startLine][startChar].left;
        }
        if (i >= startLine && i < endLine) {
          boxEnd = isJustify && !this.isEndOfWrapping(i) ? this.width : this.getLineWidth(i) || 5; // WTF is this 5?
        }
        else if (i === endLine) {
          if (endChar === 0) {
            boxEnd = this.__charBounds[endLine][endChar].left;
          }
          else {
            var charSpacing = this._getWidthOfCharSpacing();
            boxEnd = this.__charBounds[endLine][endChar - 1].left
              + this.__charBounds[endLine][endChar - 1].width - charSpacing;
          }
        }
        realLineHeight = lineHeight;
        if (this.lineHeight < 1 || (i === endLine && this.lineHeight > 1)) {
          lineHeight /= this.lineHeight;
        }
        if (this.inCompositionMode) {
          ctx.fillStyle = this.compositionColor || 'black';
          ctx.fillRect(
            boundaries.left + lineOffset + boxStart,
            boundaries.top + boundaries.topOffset + lineHeight,
            boxEnd - boxStart,
            1);
        }
        else {
          ctx.fillStyle = this.selectionColor;
          ctx.fillRect(
            boundaries.left + lineOffset + boxStart,
            boundaries.top + boundaries.topOffset,
            boxEnd - boxStart,
            lineHeight);
        }


        boundaries.topOffset += realLineHeight;
      }
    },

    /**
     * High level function to know the height of the cursor.
     * the currentChar is the one that precedes the cursor
     * Returns fontSize of char at the current cursor
     * @return {Number} Character font size
     */
    getCurrentCharFontSize: function() {
      var cp = this._getCurrentCharIndex();
      return this.getValueOfPropertyAt(cp.l, cp.c, 'fontSize');
    },

    /**
     * High level function to know the color of the cursor.
     * the currentChar is the one that precedes the cursor
     * Returns color (fill) of char at the current cursor
     * @return {String} Character color (fill)
     */
    getCurrentCharColor: function() {
      var cp = this._getCurrentCharIndex();
      return this.getValueOfPropertyAt(cp.l, cp.c, 'fill');
    },

    /**
     * Returns the cursor position for the getCurrent.. functions
     * @private
     */
    _getCurrentCharIndex: function() {
      var cursorPosition = this.get2DCursorLocation(this.selectionStart, true),
          charIndex = cursorPosition.charIndex > 0 ? cursorPosition.charIndex - 1 : 0;
      return { l: cursorPosition.lineIndex, c: charIndex };
    }
  });

  /**
   * Returns fabric.IText instance from an object representation
   * @static
   * @memberOf fabric.IText
   * @param {Object} object Object to create an instance from
   * @param {function} [callback] invoked with new instance as argument
   */
  fabric.IText.fromObject = function(object, callback) {
    parseDecoration(object);
    if (object.styles) {
      for (var i in object.styles) {
        for (var j in object.styles[i]) {
          parseDecoration(object.styles[i][j]);
        }
      }
    }
    fabric.Object._fromObject('IText', object, callback, 'text');
  };

  fabric.IText.fromElement = function(element, callback, options) {
    if (!element) {
        return callback(null);
    }
    var parsedAttributes = fabric.parseAttributes(element, fabric.Text.ATTRIBUTE_NAMES), parsedAnchor = parsedAttributes.textAnchor || "left";
    options = fabric.util.object.extend(options ? clone(options) : {}, parsedAttributes);
    options.top = options.top || 0;
    options.left = options.left || 0;
    if (parsedAttributes.textDecoration) {
        var textDecoration = parsedAttributes.textDecoration;
        if (textDecoration.indexOf("underline") !== -1) {
            options.underline = true;
        }
        if (textDecoration.indexOf("overline") !== -1) {
            options.overline = true;
        }
        if (textDecoration.indexOf("line-through") !== -1) {
            options.linethrough = true;
        }
        delete options.textDecoration;
    }
    if ("dx" in parsedAttributes) {
        options.left += parsedAttributes.dx;
    }
    if ("dy" in parsedAttributes) {
        options.top += parsedAttributes.dy;
    }
    if (!("fontSize" in options)) {
        options.fontSize = fabric.Text.DEFAULT_SVG_FONT_SIZE;
    }
    var textContent = "";
    if (!("textContent" in element)) {
        if ("firstChild" in element && element.firstChild !== null) {
            if ("data" in element.firstChild && element.firstChild.data !== null) {
                textContent = element.firstChild.data;
            }
        }
    } else {
        textContent = element.textContent;
    }
    var styles = {};
    var lines = [];
    var textLines = [];
    var former_top = null;
    var init = -1;
    for (var i = 0, l = element.children.length; i < l; i++) {
        var el = element.children[i];
        var _parsedAttributes = fabric.parseAttributes(el, fabric.Text.ATTRIBUTE_NAMES);
        if (_parsedAttributes.top !== former_top) {
            former_top = _parsedAttributes.top;
            lines[++init] = [_parsedAttributes];
            textLines[init] = el.textContent;
        } else {
            textLines[init] += el.textContent;
            lines[init].push(_parsedAttributes);
        }
        var text = el.textContent.trim();
        for (var j = 1, length = text.length; j < length; j++) {
            lines[init].push(_parsedAttributes);
        }
    }
    textContent = "";
    var spanLeft = 0, spanTop = 0;
    for (var i = 0, l = lines.length; i < l; i++) {
        styles[i] = {};
        for (var j = 0, length = lines[i].length; j < length; j++) {
            styles[i][j] = lines[i][j];
            if (styles[i][j].left) {
              spanLeft = styles[i][j].left;
            }
            if (styles[i][j].top) {
              spanTop = styles[i][j].top;
            }
        }
    }
    textContent = textLines.join('\n');

    options.styles = styles;
    var text = new fabric.IText(textContent, options), textHeightScaleFactor = text.getScaledHeight() / text.height, lineHeightDiff = (text.height + text.strokeWidth) * text.lineHeight - text.height, scaledDiff = lineHeightDiff * textHeightScaleFactor, textHeight = text.getScaledHeight() + scaledDiff, offX = 0;
    if (parsedAnchor === "center") {
        offX = text.getScaledWidth() / 2;
    }
    if (parsedAnchor === "right") {
        offX = text.getScaledWidth();
    }
    text.set({
        left: text.left - offX + spanLeft,
        top: text.top - (textHeight - text.fontSize * (.18 + text._fontSizeFraction)) / text.lineHeight + spanTop
    });
    callback(text);
  };
})();
