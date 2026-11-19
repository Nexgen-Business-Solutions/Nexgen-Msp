import { APP_TAGLINE, APP_NAME } from '../data/constant'

/** The Nexgen mark with the app name; `showText={false}` hides the name. */
export function AppLogo({ showText = true }: { showText?: boolean }) {
    return (
        <div className="flex items-center gap-3">
            <img src='/assets/nexgen_msp/images/Nexgen-Logo.png' width='72' alt="Nexgen" />
            {showText && <div className="min-w-0 border-l border-line pl-3">
                <p className="truncate text-sm font-semibold text-ink">{APP_NAME}</p>
                <p className="truncate text-xs text-muted-ink">{APP_TAGLINE}</p>
            </div>}
        </div>
    )
}
