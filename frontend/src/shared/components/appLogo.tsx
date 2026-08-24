import { APP_TAGLINE, APP_NAME } from '../data/constant'

export function AppLogo({showText=true}) {
    return (
        <div className="flex items-center gap-3 px-7 pt-7 pb-5">
            <img src='/assets/nexgen_msp/images/Nexgen-Logo.png' width='80' />
            {showText && <div className="min-w-0">
                <p className="truncate text-base font-bold text-gray-900">{APP_NAME}</p>
                <p className="truncate text-xs text-blue-700">{APP_TAGLINE}</p>
            </div>}
        </div>
    )
}
