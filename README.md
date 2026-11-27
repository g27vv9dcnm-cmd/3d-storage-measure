# 3D storage measure

「3D storage」の試作「ミニARKit」のページです。LiDARのない iPhone で、部屋の形（角の数と角度）と天井の高さを測ります。

- 測るページ: https://g27vv9dcnm-cmd.github.io/3d-storage-measure/
- センサー確認: https://g27vv9dcnm-cmd.github.io/3d-storage-measure/check.html
- データはスマホの中だけで使い、どこにも送りません。

## しくみ
部屋の真ん中に立ち、画面の十字を床の角に合わせて押していきます。スマホを持つ高さと、向き・傾き（DeviceOrientation）から角の位置を計算します（js/geom.js）。
最後に、ほぼまっすぐ・ほぼ平行・左右対称（等脚台形）の壁をそろえ、アプリの「部屋の形」と同じ形式（outline: {id, x, z} cm、上から見て時計回り）で出します。

## テスト
`node --test test/geom.test.mjs`
