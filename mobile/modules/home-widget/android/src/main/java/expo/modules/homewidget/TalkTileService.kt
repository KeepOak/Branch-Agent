package expo.modules.homewidget

import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** The Talk to Branch Quick Settings tile: a tap opens Talk in the most recent chat. */
class TalkTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    val tile = qsTile ?: return
    tile.label = getString(R.string.branch_talk_tile_label)
    tile.contentDescription = getString(R.string.branch_talk_tile_description)
    tile.state = Tile.STATE_ACTIVE
    tile.updateTile()
  }

  override fun onClick() {
    super.onClick()
    val open = HomeWidgetProvider.clickIntent(this, HomeWidgetLaunch.ACTION_TALK, REQUEST_TALK)
    val start = Runnable {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startActivityAndCollapse(open)
      } else {
        @Suppress("DEPRECATION")
        startActivityAndCollapse(HomeWidgetProvider.launchIntent(this, HomeWidgetLaunch.ACTION_TALK))
      }
    }
    // A locked phone asks to unlock first, then opens Talk.
    if (isLocked) unlockAndRun(start) else start.run()
  }

  companion object {
    private const val REQUEST_TALK = 3
  }
}
