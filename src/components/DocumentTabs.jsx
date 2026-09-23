import React, { useRef } from 'react';
import { FileText, Image as ImageIcon, FileJson, X } from 'lucide-react';

const IMAGE_REGEX = /\.(png|jpe?g|svg|gif|webp|bmp|ico|tiff?|avif)$/i;

export function DocumentTabs({
    tabs = [],
    activeTabName = '',
    onSelectTab,
    onCloseTab,
    isDirty = false
}) {
    const ribbonRef = useRef(null);

    if (!tabs || tabs.length === 0) {
        return (
            <div className="document-tabs-ribbon empty">
                <span className="document-tabs-empty-text">No open tabs</span>
            </div>
        );
    }

    const handleWheel = (e) => {
        if (ribbonRef.current) {
            if (e.deltaY !== 0) {
                ribbonRef.current.scrollLeft += e.deltaY;
            }
        }
    };

    const getTabIcon = (tab) => {
        if (tab.kind === 'image' || IMAGE_REGEX.test(tab.name)) {
            return <ImageIcon size={13} className="document-tab-icon" />;
        }
        if (tab.kind === 'bib' || tab.name.endsWith('.bib')) {
            return <FileJson size={13} className="document-tab-icon" />;
        }
        return <FileText size={13} className="document-tab-icon" />;
    };

    const getDisplayTitle = (tab) => {
        const name = tab.name || 'Untitled';
        // If path like 'notes/idea.md', return basename
        const parts = name.split('/');
        return parts[parts.length - 1];
    };

    return (
        <div
            className="document-tabs-ribbon"
            ref={ribbonRef}
            onWheel={handleWheel}
        >
            {tabs.map((tab) => {
                const isActive = tab.name === activeTabName;
                const displayTitle = getDisplayTitle(tab);

                return (
                    <div
                        key={tab.name || tab.id || Math.random()}
                        className={`document-tab ${isActive ? 'active' : ''}`}
                        onClick={() => onSelectTab && onSelectTab(tab)}
                        title={tab.name}
                    >
                        {getTabIcon(tab)}
                        <span className="document-tab-title">{displayTitle}</span>
                        {isActive && isDirty && (
                            <span className="document-tab-dirty" title="Unsaved changes" />
                        )}
                        <button
                            type="button"
                            className="document-tab-close"
                            title="Close and save"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (onCloseTab) {
                                    onCloseTab(tab, e);
                                }
                            }}
                        >
                            <X size={12} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
