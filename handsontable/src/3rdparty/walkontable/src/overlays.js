import {
  getScrollableElement,
  getScrollbarWidth,
} from '../../../helpers/dom/element';
import { requestAnimationFrame } from '../../../helpers/feature';
import { arrayEach } from '../../../helpers/array';
import { isKey } from '../../../helpers/unicode';
import { isChrome } from '../../../helpers/browser';
import {
  InlineStartOverlay,
  TopOverlay,
  TopInlineStartCornerOverlay,
  BottomOverlay,
  BottomInlineStartCornerOverlay,
} from './overlay';

/**
 * @class Overlays
 */
class Overlays {
  /**
   * Walkontable instance's reference.
   *
   * @protected
   * @type {Walkontable}
   */
  wot = null;

  /**
   * Refer to the TopOverlay instance.
   *
   * @protected
   * @type {TopOverlay}
   */
  topOverlay = null;

  /**
   * Refer to the BottomOverlay instance.
   *
   * @protected
   * @type {BottomOverlay}
   */
  bottomOverlay = null;

  /**
   * Refer to the InlineStartOverlay or instance.
   *
   * @protected
   * @type {InlineStartOverlay}
   */
  inlineStartOverlay = null;

  /**
   * Refer to the TopInlineStartCornerOverlay instance.
   *
   * @protected
   * @type {TopInlineStartCornerOverlay}
   */
  topInlineStartCornerOverlay = null;

  /**
   * Refer to the BottomInlineStartCornerOverlay instance.
   *
   * @protected
   * @type {BottomInlineStartCornerOverlay}
   */
  bottomInlineStartCornerOverlay = null;

  /**
   * Browser line height for purposes of translating mouse wheel.
   *
   * @private
   * @type {number}
   */
  browserLineHeight = undefined;

  /**
   * The walkontable settings.
   *
   * @protected
   * @type {Settings}
   */
  wtSettings = null;

  /**
   * The instance of the ResizeObserver that observes the size of the Walkontable wrapper element.
   * In case of the size change detection the `onContainerElementResize` is fired.
   *
   * @private
   * @type {ResizeObserver}
   */
  resizeObserver = new ResizeObserver((entries) => {
    requestAnimationFrame(() => {
      if (!Array.isArray(entries) || !entries.length) {
        return;
      }

      this.wtSettings.getSetting('onContainerElementResize');
    });
  });

  /**
   * @param {Walkontable} wotInstance The Walkontable instance. @todo refactoring remove.
   * @param {FacadeGetter} facadeGetter Function which return proper facade.
   * @param {DomBindings} domBindings Bindings into DOM.
   * @param {Settings} wtSettings The Walkontable settings.
   * @param {EventManager} eventManager The walkontable event manager.
   * @param {MasterTable} wtTable The master table.
   */
  constructor(wotInstance, facadeGetter, domBindings, wtSettings, eventManager, wtTable) {
    this.wot = wotInstance;
    this.wtSettings = wtSettings;
    this.domBindings = domBindings;
    this.facadeGetter = facadeGetter;
    this.wtTable = wtTable;
    const { rootDocument, rootWindow } = this.domBindings;

    // legacy support
    this.instance = this.wot; // todo refactoring: move to facade
    this.eventManager = eventManager;

    // TODO refactoring: probably invalid place to this logic
    this.scrollbarSize = getScrollbarWidth(rootDocument);

    const isOverflowHidden = rootWindow.getComputedStyle(wtTable.wtRootElement.parentNode)
      .getPropertyValue('overflow') === 'hidden';

    this.scrollableElement = isOverflowHidden ? wtTable.holder : getScrollableElement(wtTable.TABLE);

    this.initOverlays();

    this.hasScrollbarBottom = false;
    this.hasScrollbarRight = false;

    this.destroyed = false;
    this.keyPressed = false;
    this.spreaderLastSize = {
      width: null,
      height: null,
    };

    this.verticalScrolling = false;
    this.horizontalScrolling = false;

    this.initBrowserLineHeight();
    this.registerListeners();
    this.lastScrollX = rootWindow.scrollX;
    this.lastScrollY = rootWindow.scrollY;
  }

  /**
   * Retrieve browser line height and apply its value to `browserLineHeight`.
   *
   * @private
   */
  initBrowserLineHeight() {
    const { rootWindow, rootDocument } = this.domBindings;
    const computedStyle = rootWindow.getComputedStyle(rootDocument.body);
    /**
     * Sometimes `line-height` might be set to 'normal'. In that case, a default `font-size` should be multiplied by roughly 1.2.
     * Https://developer.mozilla.org/pl/docs/Web/CSS/line-height#Values.
     */
    const lineHeight = parseInt(computedStyle.lineHeight, 10);
    const lineHeightFalback = parseInt(computedStyle.fontSize, 10) * 1.2;

    this.browserLineHeight = lineHeight || lineHeightFalback;
  }

  /**
   * Prepare overlays based on user settings.
   *
   * @private
   */
  initOverlays() {
    const args = [this.wot, this.facadeGetter, this.wtSettings, this.domBindings];

    // todo refactoring: IOC, collection or factories.
    // TODO refactoring, conceive about using generic collection of overlays.
    this.topOverlay = new TopOverlay(...args);
    this.bottomOverlay = new BottomOverlay(...args);
    this.inlineStartOverlay = new InlineStartOverlay(...args);

    // TODO discuss, the controversial here would be removing the lazy creation mechanism for corners.
    // TODO cond. Has no any visual impact. They're initially hidden in same way like left, top, and bottom overlays.
    this.topInlineStartCornerOverlay = new TopInlineStartCornerOverlay(...args,
      this.topOverlay, this.inlineStartOverlay);
    this.bottomInlineStartCornerOverlay = new BottomInlineStartCornerOverlay(...args,
      this.bottomOverlay, this.inlineStartOverlay);
  }

  /**
   * Update state of rendering, check if changed.
   *
   * @package
   * @returns {boolean} Returns `true` if changes applied to overlay needs scroll synchronization.
   */
  updateStateOfRendering() {
    let syncScroll = this.topOverlay.updateStateOfRendering();

    syncScroll = this.bottomOverlay.updateStateOfRendering() || syncScroll;
    syncScroll = this.inlineStartOverlay.updateStateOfRendering() || syncScroll;

    // todo refactoring: move conditions into updateStateOfRendering(),
    if (this.inlineStartOverlay.needFullRender) {
      if (this.topOverlay.needFullRender) {
        syncScroll = this.topInlineStartCornerOverlay.updateStateOfRendering() || syncScroll;
      }
      if (this.bottomOverlay.needFullRender) {
        syncScroll = this.bottomInlineStartCornerOverlay.updateStateOfRendering() || syncScroll;
      }
    }

    return syncScroll;
  }

  /**
   * Refresh and redraw table.
   */
  refreshAll() {
    if (!this.wot.drawn) {
      return;
    }
    if (!this.wtTable.holder.parentNode) {
      // Walkontable was detached from DOM, but this handler was not removed
      this.destroy();

      return;
    }
    this.wot.draw(true);

    if (this.verticalScrolling) {
      this.inlineStartOverlay.onScroll(); // todo the inlineStartOverlay.onScroll() fires hook. Why is it needed there, not in any another place?
    }

    if (this.horizontalScrolling) {
      this.topOverlay.onScroll();
    }

    this.verticalScrolling = false;
    this.horizontalScrolling = false;
  }

  /**
   * Register all necessary event listeners.
   */
  registerListeners() {
    const { rootDocument, rootWindow } = this.domBindings;
    const { mainTableScrollableElement: topOverlayScrollableElement } = this.topOverlay;
    const { mainTableScrollableElement: inlineStartOverlayScrollableElement } = this.inlineStartOverlay;

    this.eventManager.addEventListener(rootDocument.documentElement, 'keydown', event => this.onKeyDown(event));
    this.eventManager.addEventListener(rootDocument.documentElement, 'keyup', () => this.onKeyUp());
    this.eventManager.addEventListener(rootDocument, 'visibilitychange', () => this.onKeyUp());
    this.eventManager.addEventListener(
      topOverlayScrollableElement,
      'scroll',
      event => this.onTableScroll(event),
      { passive: true }
    );

    if (topOverlayScrollableElement !== inlineStartOverlayScrollableElement) {
      this.eventManager.addEventListener(
        inlineStartOverlayScrollableElement,
        'scroll',
        event => this.onTableScroll(event),
        { passive: true }
      );
    }

    const isHighPixelRatio = rootWindow.devicePixelRatio && rootWindow.devicePixelRatio > 1;
    const isScrollOnWindow = this.scrollableElement === rootWindow;
    const preventWheel = this.wtSettings.getSetting('preventWheel');
    const wheelEventOptions = { passive: isScrollOnWindow };

    if (preventWheel || isHighPixelRatio || !isChrome()) {
      this.eventManager.addEventListener(
        this.wtTable.wtRootElement,
        'wheel',
        event => this.onCloneWheel(event, preventWheel),
        wheelEventOptions
      );
    }

    const overlays = [
      this.topOverlay,
      this.bottomOverlay,
      this.inlineStartOverlay,
      this.topInlineStartCornerOverlay,
      this.bottomInlineStartCornerOverlay,
    ];

    overlays.forEach((overlay) => {
      if (overlay && overlay.needFullRender) {
        const { holder } = overlay.clone.wtTable; // todo rethink, maybe: overlay.getHolder()

        this.eventManager.addEventListener(
          holder,
          'wheel',
          event => this.onCloneWheel(event, preventWheel),
          wheelEventOptions
        );
      }
    });

    let resizeTimeout;

    this.eventManager.addEventListener(rootWindow, 'resize', () => {
      clearTimeout(resizeTimeout);

      resizeTimeout = setTimeout(() => {
        this.wtSettings.getSetting('onWindowResize');
      }, 200);
    });

    if (!isScrollOnWindow) {
      this.resizeObserver.observe(this.wtTable.wtRootElement.parentElement);
    }
  }

  /**
   * Deregister all previously registered listeners.
   */
  deregisterListeners() {
    this.eventManager.clearEvents(true);
  }

  /**
   * Scroll listener.
   *
   * @param {Event} event The mouse event object.
   */
  onTableScroll(event) {
    // There was if statement which controlled flow of this function. It avoided the execution of the next lines
    // on mobile devices. It was changed. Broader description of this case is included within issue #4856.
    const rootWindow = this.domBindings.rootWindow;
    const masterHorizontal = this.inlineStartOverlay.mainTableScrollableElement;
    const masterVertical = this.topOverlay.mainTableScrollableElement;
    const target = event.target;

    // For key press, sync only master -> overlay position because while pressing Walkontable.render is triggered
    // by hot.refreshBorder
    if (this.keyPressed) {
      if ((masterVertical !== rootWindow && target !== rootWindow && !event.target.contains(masterVertical)) ||
          (masterHorizontal !== rootWindow && target !== rootWindow && !event.target.contains(masterHorizontal))) {
        return;
      }
    }

    this.syncScrollPositions(event);
  }

  /**
   * Wheel listener for cloned overlays.
   *
   * @param {Event} event The mouse event object.
   * @param {boolean} preventDefault If `true`, the `preventDefault` will be called on event object.
   */
  onCloneWheel(event, preventDefault) {
    const { rootWindow } = this.domBindings;

    // There was if statement which controlled flow of this function. It avoided the execution of the next lines
    // on mobile devices. It was changed. Broader description of this case is included within issue #4856.

    const masterHorizontal = this.inlineStartOverlay.mainTableScrollableElement;
    const masterVertical = this.topOverlay.mainTableScrollableElement;
    const target = event.target;

    // For key press, sync only master -> overlay position because while pressing Walkontable.render is triggered
    // by hot.refreshBorder
    const shouldNotWheelVertically = masterVertical !== rootWindow &&
      target !== rootWindow && !target.contains(masterVertical);
    const shouldNotWheelHorizontally = masterHorizontal !== rootWindow &&
      target !== rootWindow && !target.contains(masterHorizontal);

    if (this.keyPressed && (shouldNotWheelVertically || shouldNotWheelHorizontally)) {
      return;
    }

    const isScrollPossible = this.translateMouseWheelToScroll(event);

    if (preventDefault || (this.scrollableElement !== rootWindow && isScrollPossible)) {
      event.preventDefault();
    }
  }

  /**
   * Key down listener.
   *
   * @param {Event} event The keyboard event object.
   */
  onKeyDown(event) {
    this.keyPressed = isKey(event.keyCode, 'ARROW_UP|ARROW_RIGHT|ARROW_DOWN|ARROW_LEFT');
  }

  /**
   * Key up listener.
   */
  onKeyUp() {
    this.keyPressed = false;
  }

  /**
   * Translate wheel event into scroll event and sync scroll overlays position.
   *
   * @private
   * @param {Event} event The mouse event object.
   * @returns {boolean}
   */
  translateMouseWheelToScroll(event) {
    let deltaY = isNaN(event.deltaY) ? (-1) * event.wheelDeltaY : event.deltaY;
    let deltaX = isNaN(event.deltaX) ? (-1) * event.wheelDeltaX : event.deltaX;

    if (event.deltaMode === 1) {
      deltaX += deltaX * this.browserLineHeight;
      deltaY += deltaY * this.browserLineHeight;
    }

    const isScrollVerticallyPossible = this.scrollVertically(deltaY);
    const isScrollHorizontallyPossible = this.scrollHorizontally(deltaX);

    return isScrollVerticallyPossible || isScrollHorizontallyPossible;
  }

  /**
   * Scrolls main scrollable element horizontally.
   *
   * @param {number} delta Relative value to scroll.
   * @returns {boolean}
   */
  scrollVertically(delta) {
    const previousScroll = this.scrollableElement.scrollTop;

    this.scrollableElement.scrollTop += delta;

    return previousScroll !== this.scrollableElement.scrollTop;
  }

  /**
   * Scrolls main scrollable element horizontally.
   *
   * @param {number} delta Relative value to scroll.
   * @returns {boolean}
   */
  scrollHorizontally(delta) {
    const previousScroll = this.scrollableElement.scrollLeft;

    this.scrollableElement.scrollLeft += delta;

    return previousScroll !== this.scrollableElement.scrollLeft;
  }

  /**
   * Synchronize scroll position between master table and overlay table.
   *
   * @private
   */
  syncScrollPositions() {
    if (this.destroyed) {
      return;
    }

    const { rootWindow } = this.domBindings;
    const topHolder = this.topOverlay.clone.wtTable.holder; // todo rethink
    const leftHolder = this.inlineStartOverlay.clone.wtTable.holder; // todo rethink

    const [scrollLeft, scrollTop] = [this.scrollableElement.scrollLeft, this.scrollableElement.scrollTop];

    this.horizontalScrolling = (topHolder.scrollLeft !== scrollLeft || this.lastScrollX !== rootWindow.scrollX);
    this.verticalScrolling = (leftHolder.scrollTop !== scrollTop || this.lastScrollY !== rootWindow.scrollY);
    this.lastScrollX = rootWindow.scrollX;
    this.lastScrollY = rootWindow.scrollY;

    if (this.horizontalScrolling) {
      topHolder.scrollLeft = scrollLeft;

      const bottomHolder = this.bottomOverlay.needFullRender ? this.bottomOverlay.clone.wtTable.holder : null; // todo rethink

      if (bottomHolder) {
        bottomHolder.scrollLeft = scrollLeft;
      }
    }

    if (this.verticalScrolling) {
      leftHolder.scrollTop = scrollTop;
    }

    this.refreshAll();
  }

  /**
   * Synchronize overlay scrollbars with the master scrollbar.
   */
  syncScrollWithMaster() {
    const master = this.topOverlay.mainTableScrollableElement;
    const { scrollLeft, scrollTop } = master;

    if (this.topOverlay.needFullRender) {
      this.topOverlay.clone.wtTable.holder.scrollLeft = scrollLeft; // todo rethink, *overlay.setScroll*()
    }
    if (this.bottomOverlay.needFullRender) {
      this.bottomOverlay.clone.wtTable.holder.scrollLeft = scrollLeft; // todo rethink, *overlay.setScroll*()
    }
    if (this.inlineStartOverlay.needFullRender) {
      this.inlineStartOverlay.clone.wtTable.holder.scrollTop = scrollTop; // todo rethink, *overlay.setScroll*()
    }
  }

  /**
   * Update the main scrollable elements for all the overlays.
   */
  updateMainScrollableElements() {
    this.deregisterListeners();

    this.inlineStartOverlay.updateMainScrollableElement();
    this.topOverlay.updateMainScrollableElement();

    if (this.bottomOverlay.needFullRender) {
      this.bottomOverlay.updateMainScrollableElement();
    }
    const { wtTable } = this;
    const { rootWindow } = this.domBindings;

    if (rootWindow.getComputedStyle(wtTable.wtRootElement.parentNode).getPropertyValue('overflow') === 'hidden') {
      this.scrollableElement = wtTable.holder;
    } else {
      this.scrollableElement = getScrollableElement(wtTable.TABLE);
    }

    this.registerListeners();
  }

  /**
   *
   */
  destroy() {
    this.resizeObserver.disconnect();
    this.eventManager.destroy();
    // todo, probably all below `destory` calls has no sense. To analyze
    this.topOverlay.destroy();

    if (this.bottomOverlay.clone) {
      this.bottomOverlay.destroy();
    }
    this.inlineStartOverlay.destroy();

    if (this.topInlineStartCornerOverlay) {
      this.topInlineStartCornerOverlay.destroy();
    }

    if (this.bottomInlineStartCornerOverlay && this.bottomInlineStartCornerOverlay.clone) {
      this.bottomInlineStartCornerOverlay.destroy();
    }

    this.destroyed = true;
  }

  /**
   * @param {boolean} [fastDraw=false] When `true`, try to refresh only the positions of borders without rerendering
   *                                   the data. It will only work if Table.draw() does not force
   *                                   rendering anyway.
   */
  refresh(fastDraw = false) {
    const spreader = this.wtTable.spreader;
    const width = spreader.clientWidth;
    const height = spreader.clientHeight;

    if (width !== this.spreaderLastSize.width || height !== this.spreaderLastSize.height) {
      this.spreaderLastSize.width = width;
      this.spreaderLastSize.height = height;
      this.adjustElementsSize();
    }

    if (this.bottomOverlay.clone) {
      this.bottomOverlay.refresh(fastDraw);
    }

    this.inlineStartOverlay.refresh(fastDraw);
    this.topOverlay.refresh(fastDraw);

    if (this.topInlineStartCornerOverlay) {
      this.topInlineStartCornerOverlay.refresh(fastDraw);
    }

    if (this.bottomInlineStartCornerOverlay && this.bottomInlineStartCornerOverlay.clone) {
      this.bottomInlineStartCornerOverlay.refresh(fastDraw);
    }
  }

  /**
   * Adjust overlays elements size and master table size.
   *
   * @param {boolean} [force=false] When `true`, it adjust the DOM nodes sizes for all overlays.
   */
  adjustElementsSize(force = false) {
    const { wtViewport } = this.wot;
    const { wtTable } = this;
    const totalColumns = this.wtSettings.getSetting('totalColumns');
    const totalRows = this.wtSettings.getSetting('totalRows');
    const headerRowSize = wtViewport.getRowHeaderWidth();
    const headerColumnSize = wtViewport.getColumnHeaderHeight();
    const hiderStyle = wtTable.hider.style;

    hiderStyle.width = `${headerRowSize + this.inlineStartOverlay.sumCellSizes(0, totalColumns)}px`;
    hiderStyle.height = `${headerColumnSize + this.topOverlay.sumCellSizes(0, totalRows) + 1}px`;

    if (this.scrollbarSize > 0) { // todo refactoring, looking as a part of logic which should be moved outside the class
      const {
        scrollHeight: rootElemScrollHeight,
        scrollWidth: rootElemScrollWidth,
      } = wtTable.wtRootElement;
      const {
        scrollHeight: holderScrollHeight,
        scrollWidth: holderScrollWidth,
      } = wtTable.holder;

      this.hasScrollbarRight = rootElemScrollHeight < holderScrollHeight;
      this.hasScrollbarBottom = rootElemScrollWidth < holderScrollWidth;

      if (this.hasScrollbarRight && wtTable.hider.scrollWidth + this.scrollbarSize > rootElemScrollWidth) {
        this.hasScrollbarBottom = true;
      } else if (this.hasScrollbarBottom && wtTable.hider.scrollHeight + this.scrollbarSize > rootElemScrollHeight) {
        this.hasScrollbarRight = true;
      }
    }

    this.topOverlay.adjustElementsSize(force);
    this.inlineStartOverlay.adjustElementsSize(force);
    this.bottomOverlay.adjustElementsSize(force);
  }

  /**
   *
   */
  applyToDOM() {
    if (!this.wtTable.isVisible()) {
      return;
    }

    this.topOverlay.applyToDOM();

    if (this.bottomOverlay.clone) {
      this.bottomOverlay.applyToDOM();
    }

    this.inlineStartOverlay.applyToDOM();
  }

  /**
   * Get the parent overlay of the provided element.
   *
   * @param {HTMLElement} element An element to process.
   * @returns {object|null}
   */
  getParentOverlay(element) {
    if (!element) {
      return null;
    }

    const overlays = [
      this.topOverlay,
      this.inlineStartOverlay,
      this.bottomOverlay,
      this.topInlineStartCornerOverlay,
      this.bottomInlineStartCornerOverlay
    ];
    let result = null;

    arrayEach(overlays, (overlay) => {
      if (!overlay) {
        return;
      }

      if (overlay.clone && overlay.clone.wtTable.TABLE.contains(element)) { // todo demeter
        result = overlay.clone;
      }
    });

    return result;
  }

  /**
   * Synchronize the class names between the main overlay table and the tables on the other overlays.
   *
   */
  syncOverlayTableClassNames() {
    const masterTable = this.wtTable.TABLE;
    const overlays = [
      this.topOverlay,
      this.inlineStartOverlay,
      this.bottomOverlay,
      this.topInlineStartCornerOverlay,
      this.bottomInlineStartCornerOverlay
    ];

    arrayEach(overlays, (elem) => {
      if (!elem) {
        return;
      }

      elem.clone.wtTable.TABLE.className = masterTable.className; // todo demeter
    });
  }
}

export default Overlays;
